const fs = require("fs");
const lockFile = require("lockfile");
const dbFile = "db.json";
const lock = "db.lock";

module.exports = (slack, slackInteractions) => {
    slackInteractions.action("menu_button", (payload, respond) => {
        if ("request_private_channel" == payload.actions[0].name) {
            return requestPrivateChannel(payload, respond);
        } else if ("list_private_channels" == payload.actions[0].name) {
            lockFile.lockSync(lock);
            if (!fs.existsSync(dbFile)) {
                lockFile.unlockSync(lock);
                respond({ text: "There are currently no active private channels right now, " +
                    "type `help` if you would like to request one." });
                return;
            }

            const channels = JSON.parse(fs.readFileSync(dbFile));
            const cursor = parseInt(payload.actions[0].value) || 0
            let attachments = [];
            for (let i = cursor; i < Math.min(cursor + 5, channels.length); ++i) {
                const channel = channels[i];
                let text = `_${channel.topic}_`;
                if (channel.purpose) {
                    text += "\n" + channel.purpose;
                }

                attachments.push({
                    title: `#${channel.name}`,
                    text,
                    callback_id: "join_channel_button",
                    actions: [
                        {
                            name: "join_channel",
                            text: "Join",
                            type: "button",
                            style: "primary",
                            value: channel.id
                        },
                        {
                            name: "archive_channel",
                            text: "Archive",
                            type: "button",
                            value: channel.id,
                            confirm: {
                                title: `Archive #${channel.name}`,
                                text: `Are you sure you want to archive ${channel.name}?`,
                                ok_text: "Yes",
                                dismiss_text: "No"
                            }
                        }],
                    footer: "Date created",
                    ts: channel.created,
                    mrkdwn: true
                });
            }

            let actions = [];
            if (cursor >= 5) {
                actions.push({
                    name: "list_private_channels",
                    text: "Prev page",
                    type: "button",
                    value: cursor - 5
                });
            }
            if (cursor + 5 < channels.length) {
                actions.push({
                    name: "list_private_channels",
                    text: "Next page",
                    type: "button",
                    value: cursor + 5
                });
            }
            if (channels.length > 5) {
                attachments.push({
                    text: "See more channels...",
                    callback_id: "menu_button",
                    actions
                });
            }
            respond({
                text: "Here is a `list` of the currently active private channels:",
                attachments
            });
            lockFile.unlockSync(lock);
        }
    });

    slackInteractions.action("join_channel_button", (payload, respond) => {
        const channel = payload.actions[0].value;
        let reply = payload.original_message;

        if ("join_channel" == payload.actions[0].name) {
            for (var i = 0; i < reply.attachments.length; ++i) {
                if (channel == reply.attachments[i].actions[0].value) {
                    reply.attachments[i].actions.splice(0, 1);
                    reply.attachments[i].color = "good";
                    reply.attachments[i].text += "\n:white_check_mark: You have been invited to this channel."
                    break;
                }
            }
            slack.conversations.invite({
                channel,
                users: payload.user.id
            }).then(() => {
                respond(reply);
            }).catch((error) => {
                console.error("error received: ", error);
            });
        } else if ("archive_channel" == payload.actions[0].name) {
            for (var i = 0; i < reply.attachments.length; ++i) {
                if (channel == reply.attachments[i].actions[0].value) {
                    delete reply.attachments[i].actions;
                    reply.attachments[i].color = "warning";
                    reply.attachments[i].text += "\n:file_folder: This channel is now archived.";
                    break;
                }
            }

            slack.conversations.archive({
                channel
            }).then(() => {
                respond(reply);
            }).catch((error) => {
                console.error("error received: ", error);
            });
        }

        return reply;
    });

    slackInteractions.action("request_channel_action", requestPrivateChannel);

    slackInteractions.action("channel_request_dialog", (payload, respond) => {
        let channel_name = payload.submission.channel_name.trim().toLowerCase();
        const me = payload.user.id;
        const { invitee, organization, expire_days, purpose } = payload.submission;
        const topic = `Requested for <@${invitee}> from ${organization}`;

        if (invitee == me) {
            return {
                errors: [{
                    name: "invitee",
                    error: "You cannot request a new private channel with just yourself in it!"
                }]
            };
        } else if (!/^[a-z0-9_-]+$/.test(channel_name)) {
            return {
                errors: [{
                    name: "channel_name",
                    error: "Invalid characters found."
                }]
            };
        } else if (!/^[1-9]\d*$/.test(expire_days)) {
            return {
                errors: [{
                    name: "expire_days",
                    error: "Please enter a valid positive integer."
                }]
            };
        }

        let channel = "";
        let created = 0;
        return slack.users.info({
            user: invitee
        }).then((res) => {
            if (res.user.is_bot || res.user.is_app_user) {
                return {
                    errors: [{
                        name: "invitee",
                        error: "Invited user must be human."
                    }]
                };
            } else {
                return slack.conversations.create({
                    name: channel_name,
                    is_private: true,
                    user_ids: `${me},${invitee}`
                })
            }
        }).then((res) => {
            if (res.errors) {
                return res;
            }

            channel = res.channel.id;
            channel_name = res.channel.name;
            created = res.channel.created;
            return slack.conversations.setTopic({ channel, topic });
        }).then((res) => {
            if (res.errors) {
                return res;
            }

            return slack.conversations.setPurpose({
                channel,
                purpose: payload.submission.purpose
            });
        }).then((res) => {
            if (res.errors) {
                return res;
            }

            lockFile.lockSync(lock);
            let channels = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile)) : [];
            channels.push({
                id: channel,
                name: channel_name,
                created,
                user: invitee,
                organization: organization || "",
                topic,
                purpose,
                expire_days: parseInt(expire_days)
            });
            fs.writeFileSync(dbFile, JSON.stringify(channels));
            lockFile.unlockSync(lock);

            respond({ text: `Successfully created private channel for <@${invitee}> from ${organization}!` });
        }).catch((error) => {
            console.error("error received: ", error);
        });
    });

    function requestPrivateChannel(payload) {
        let reply = payload.original_message || payload.message;
        const user = reply.user;
        if (reply.attachments) {
            delete reply.attachments;
            reply.text = ":building_construction: Requesting private channel...";
        }
        slack.dialog.open({
            trigger_id: payload.trigger_id,
            dialog: {
                callback_id: "channel_request_dialog",
                title: "Request private channel",
                submit_label: "Submit",
                elements: [
                    {
                        type: "text",
                        label: "Channel name",
                        name: "channel_name",
                        min_length: 1,
                        max_length: 21,
                        hint: "May only contain lowercase letters, numbers, hyphens, and underscores."
                    },
                    {
                        type: "select",
                        label: "Invite user",
                        name: "invitee",
                        data_source: "users",
                        value: user || null
                    },
                    {
                        type: "text",
                        label: "Organization/Customer",
                        name: "organization",
                        optional: true
                    },
                    {
                        type: "text",
                        subtype: "number",
                        label: "Days until expiry",
                        name: "expire_days",
                        hint: "Enter a positive integer."
                    },
                    {
                        type: "textarea",
                        label: "Purpose of channel",
                        name: "purpose",
                        optional: true,
                        max_length: 250
                    }
                ]
            }
        }).catch((error) => {
            console.log("Error occurred: ", error);
        });

        return reply;
    }
};
