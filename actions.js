/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

module.exports = (shared, slack, slackInteractions) => {
    slackInteractions.action("menu_button", (payload) => {
        if ("request_private_channel" == payload.actions[0].name) {
            return requestChannel(payload);
        } else if ("list_private_channels" == payload.actions[0].name) {
            const { cursor, searchTerms } = JSON.parse(payload.actions[0].value);
            return shared.listChannels(cursor || 0, searchTerms || "").then((result) => {
                return result.data;
            });
        }
    });

    slackInteractions.action("join_channel_button", (payload) => {
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
            return slack.conversations.invite({
                channel,
                users: payload.user.id
            }).then(() => {
                return reply;
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

            return slack.conversations.archive({
                channel
            }).then(() => {
                return reply;
            });
        }
    });

    slackInteractions.action("channel_request_dialog", (payload, respond) => {
        let channel_name = payload.submission.channel_name.trim().toLowerCase();
        const me = payload.user.id;
        const { invitee, organization, expire_days, purpose } = payload.submission;
        let topic = `Requested for <@${invitee}>`;
        if (organization) {
            topic += " from " + organization;
        }

        let errors = [];
        if (invitee == me) {
            errors.push({
                name: "invitee",
                error: "You cannot request a new private channel with just yourself in it!"
            });
        }

        if (!/^[a-z0-9_-]+$/.test(channel_name)) {
            errors.push({
                name: "channel_name",
                error: "Invalid characters found."
            });
        }

        if (!/^[1-9]\d*$/.test(expire_days)) {
            errors.push({
                name: "expire_days",
                error: "Please enter a valid positive integer."
            });
        }

        if (errors.length > 0) {
            return { errors };
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

            return shared.processChannels((channels) => {
                const newChannel = {
                    id: channel,
                    name: channel_name,
                    created,
                    user: invitee,
                    organization: organization || "",
                    topic,
                    purpose,
                    expire_days: parseInt(expire_days)
                };
                channels.push(newChannel);
                return { channels, writeBack: true };
            });
        }).then((result) => {
            if (result.errors) {
                return result;
            }

            respond({ text: `Successfully created private channel for <@${invitee}> from ${organization}!` });
        });
    });

    slackInteractions.action("expire_warning_button", (payload) => {
        if ("yes" == payload.actions[0].name) {
            return shared.processChannels((channels) => {
                if (0 == channels.length) {
                    return { errors: "Fatal error: channel doesn't exist in database." };
                }

                for (let i = 0; i < channels.length; ++i) {
                    if (channels[i].id == payload.channel.id) {
                        channels[i].expire_days += 7;
                        break;
                    }
                }

                return {
                    channels,
                    writeBack: true,
                    data: {
                        text: ":white_check_mark: Successfully extended channel length by a week."
                    }
                };
            }).then((result) => {
                return result.data;
            });
        } else {
            return { text: "Ok, this channel will expire within the week." };
        }
    });

    slackInteractions.action("request_channel_action", requestChannel);

    function requestChannel(payload) {
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
                        value: user || ""
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
        }).catch(console.error);

        return reply;
    }
};
