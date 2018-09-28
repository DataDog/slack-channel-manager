/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

module.exports = (shared, Channel, slack, slackInteractions) => {
    slackInteractions.action("menu_button", (payload) => {
        if ("request_private_channel" == payload.actions[0].name) {
            return requestChannel(payload);
        } else if ("list_private_channels" == payload.actions[0].name) {
            const { cursor, searchTerms } = JSON.parse(payload.actions[0].value);
            return shared.listChannels(cursor || 0, searchTerms || "");
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
            return slack.user.groups.invite({ channel, user: payload.user.id })
                .then(() => reply)
                .catch(console.error);
        } else if ("archive_channel" == payload.actions[0].name) {
            for (var i = 0; i < reply.attachments.length; ++i) {
                if (channel == reply.attachments[i].actions[0].value) {
                    delete reply.attachments[i].actions;
                    reply.attachments[i].color = "warning";
                    reply.attachments[i].text += "\n:file_folder: This channel is now archived.";
                    break;
                }
            }

            return slack.user.groups.archive({ channel })
                .then(() => reply)
                .catch(console.error);
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
        return slack.bot.users.info({
            user: invitee
        }).then((res) => {
            if (res.user.is_bot || res.user.is_app_user) {
                return {
                    errors: [{
                        name: "invitee",
                        error: "Invited user must be human."
                    }]
                };
            }

            // TODO: move to conversations API after workspace app migration
            return slack.user.groups.create({ name: channel_name });
        }).then((res) => {
            if (res.errors) return res;

            channel = res.group.id;
            channel_name = res.group.name;
            created = res.group.created;

            return Promise.all([
                slack.user.conversations.invite({ channel, users: `${invitee},${me}` }),
                slack.user.groups.setTopic({ channel, topic }),
                slack.user.groups.setPurpose({ channel, purpose }),
                slack.user.groups.leave({ channel })
            ]);
        }).then((res) => {
            if (res.errors) return res;

            return Channel.insertMany([{
                _id: channel,
                name: channel_name,
                created,
                user: invitee,
                organization: organization || "",
                topic,
                purpose,
                expire_days: parseInt(expire_days)
            }]);
        }).then((res) => {
            if (res.errors) return res;

            respond({ text: `Successfully created private channel #${channel_name} for <@${invitee}> from ${organization}!` });
        }).catch(console.error);
    });

    slackInteractions.action("expire_warning_button", (payload) => {
        if ("extend" == payload.actions[0].name) {
            return Channel.findByIdAndUpdate(payload.channel.id, { reminded: false, $inc: { expire_days: 7 } })
                .exec()
                .then(() => { text: ":white_check_mark: Successfully extended channel length by a week." })
                .catch(console.error);
        } else if ("ignore" == payload.actions[0].name) {
            return { text: "Ok, this channel will expire within the week. You can ignore this." };
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
        slack.bot.dialog.open({
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
