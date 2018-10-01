/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

module.exports = (shared, logger, Channel, slack, slackInteractions) => {
    slackInteractions.action("menu_button", async (payload) => {
        logger.info("Button press", {
            user_id: payload.user.id,
            type: "button",
            callback_id: "menu_button",
            action: payload.actions[0]
        });

        if ("request_private_channel" == payload.actions[0].name) {
            return requestChannel(payload);
        } else if ("list_private_channels" == payload.actions[0].name) {
            const { cursor, searchTerms } = JSON.parse(payload.actions[0].value);
            return shared.listChannels(cursor || 0, searchTerms || "");
        }
    });

    slackInteractions.action("join_channel_button", async (payload) => {
        logger.info("Button press", {
            user_id: payload.user.id,
            type: "button",
            callback_id: "join_channel_button",
            action: payload.actions[0]
        });

        const channel = payload.actions[0].value;
        let reply = payload.original_message;

        if ("join_channel" == payload.actions[0].name) {
            try {
                await slack.user.groups.invite({ channel, user: payload.user.id });
            } catch (err) {
                if (err.data) {
                    if ("channel_not_found" == err.data.error || "is_archived" == err.data.error) {
                        return { text: "Oops, looks like this channel is already inactive. " +
                            "Please refresh the channel list." };
                    }
                } else {
                    logger.error(err);
                    return { text: "Fatal: unknown platform error" };
                }
            }

            for (let i = 0; i < reply.attachments.length; ++i) {
                if (channel == reply.attachments[i].actions[0].value) {
                    reply.attachments[i].actions.splice(0, 1);
                    reply.attachments[i].color = "good";
                    reply.attachments[i].text += "\n:white_check_mark: You have been invited to this channel."
                    return reply;
                }
            }
        } else if ("archive_channel" == payload.actions[0].name) {
            try {
                await slack.user.groups.archive({ channel });
            } catch (err) {
                if (err.data) {
                    if ("channel_not_found" == err.data.error || "already_archived" == err.data.error) {
                        return { text: "Oops, looks like this channel is already inactive. " +
                            "Please refresh the channel list." };
                    }
                } else {
                    logger.error(err);
                    return { text: "Fatal: unknown platform error" };
                }
            }
            for (let i = 0; i < reply.attachments.length; ++i) {
                if (channel == reply.attachments[i].actions[0].value) {
                    delete reply.attachments[i].actions;
                    reply.attachments[i].color = "warning";
                    reply.attachments[i].text += "\n:file_folder: This channel is now archived.";
                    return reply;
                }
            }
        }
    });

    slackInteractions.action("channel_request_dialog", async (payload, respond) => {
        logger.info("Dialog submission", {
            user_id: payload.user.id,
            type: "dialog_submission",
            callback_id: "channel_request_dialog",
            submission: payload.submission
        });

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

        if (!/^[a-z0-9_-]{1,21}$/.test(channel_name)) {
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

        const res = await slack.bot.users.info({ user: invitee });
        if (res.user.is_bot || res.user.is_app_user) {
            return {
                errors: [{
                    name: "invitee",
                    error: "Invited user must be human."
                }]
            };
        }

        try {
            // TODO move to conversations API after workspace app migration
            res = await slack.user.groups.create({ name: channel_name });
        } catch (err) {
            if (err.data) {
                if ("name_taken" == err.data.error) {
                    return {
                        errors: [{
                            name: "channel_name",
                            error: "This channel name is already taken."
                        }]
                    };
                } else if ("restricted_action" == err.data.error) {
                    return {
                        errors: [{
                            name: "channel_name",
                            error: "You are not allowed to request private channels in this Slack workspace," +
                            "please contact the administrators."
                        }]
                    };
                }
            } else {
                return { errors: [{ error: "Fatal: unknown platform error" }] };
            }
        }

        const channel = res.group.id;
        const created = res.group.created;
        channel_name = res.group.name;

        res = await Promise.all([
            slack.user.conversations.invite({ channel, users: `${invitee},${me}` }),
            slack.user.groups.setTopic({ channel, topic }),
            slack.user.groups.setPurpose({ channel, purpose }),
        ]);

        res = await Promise.all([
            slack.user.groups.leave({ channel }),
            Channel.insertMany([{
                _id: channel,
                name: channel_name,
                created,
                user: invitee,
                organization: organization || "",
                topic,
                purpose,
                expire_days: parseInt(expire_days)
            }])
        ]);

        respond({ text: `Successfully created private channel #${channel_name} for <@${invitee}> from ${organization}!` });
    });

    slackInteractions.action("expire_warning_button", async (payload) => {
        logger.info("Button press", {
            user_id: payload.user.id,
            type: "button",
            callback_id: "expire_warning_button",
            action: payload.actions[0]
        });

        if ("extend" == payload.actions[0].name) {
            return Channel.findByIdAndUpdate(payload.channel.id, { reminded: false, $inc: { expire_days: 7 } })
                .exec()
                .then(() => { text: ":white_check_mark: Successfully extended channel length by a week." })
                .catch(logger.error);
        } else if ("ignore" == payload.actions[0].name) {
            return { text: "Ok, this channel will expire within the week. You can ignore this." };
        }
    });

    slackInteractions.action("request_channel_action", async (payload) => {
        logger.info("Message action", {
            user_id: payload.user.id,
            type: "message_action",
            callback_id: "request_channel_action",
            message: payload.message
        });
        return requestChannel(payload);
    });

    async function requestChannel(payload) {
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
        });

        return reply;
    }
};
