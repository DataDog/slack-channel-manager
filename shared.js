/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

const authChannel = process.env.AUTH_CHANNEL;
const ts_day = 60*60*24;

module.exports = (Channel, slack) => {
    return {
        isUserAuthorized: async function(user) {
            let cursor = "";
            // Slack's API has a max cap on the number of channels returned,
            // so we have to loop until we find one (or don't)
            do {
                const res = await slack.user.users.conversations({
                    cursor,
                    exclude_archived: true,
                    types: "private_channel",
                    user: user
                });
                if (res.channels.find(c => authChannel == c.name)) {
                    return true;
                }

                cursor = res.response_metadata.next_cursor;
            } while (cursor);

            return false;
        },

        listChannels: async function(offset, searchTerms) {
            // fuzzy search by channel name and organization
            const query = (!searchTerms) ? {} : {
                $or: [
                    { name: { $regex: searchTerms, $options: "i" } },
                    { organization: { $regex: searchTerms, $options: "i" } }
                ]
            };

            const paginatedData = await Channel.paginate(query, {
                offset,
                limit: 5
            });

            const channels = paginatedData.docs;
            if (0 == channels.length) {
                return {
                    text: "There are no active private channels that match " +
                    "your query, type `help` if you would like to request one."
                };
            }

            let attachments = [];
            channels.forEach((channel) => {
                let text = "";
                if (channel.topic) {
                    text += `_${channel.topic}_`;
                }
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
                    footer: "Expiry Date",
                    ts: channel.ts_expiry,
                    mrkdwn: true
                });
            });

            const actions = [];
            
            // if we are not on the first page, then there must be a previous
            // page of results
            if (offset >= 5) {
                actions.push({
                    name: "list_private_channels",
                    text: "Prev page",
                    type: "button",
                    value: JSON.stringify({
                        offset: offset - 5,
                        searchTerms
                    })
                });
            }

            // if there are more pages left, add a next page button
            if (offset + 5 < paginatedData.total) {
                actions.push({
                    name: "list_private_channels",
                    text: "Next page",
                    type: "button",
                    value: JSON.stringify({
                        offset: offset + 5,
                        searchTerms
                    })
                });
            }

            // only show the pagination details if there are multiple pages
            if (paginatedData.total > 5) {
                attachments.push({
                    text: "See more channels...",
                    callback_id: "menu_button",
                    actions
                });
            }

            return {
                text: "Here is a `list` of active private channels that " +
                "match your query.",
                attachments
            };
        },

        extendChannelExpiry: async function(channel_id, num_days) {
            return Channel.findByIdAndUpdate(channel_id, {
                $inc: { ts_expiry: num_days * ts_day },
                reminded: false,
            }).exec();
        },

        isManagedChannel: async function(channel_id) {
            return Channel.findById(channel_id).exec();
        },

        removeUserFromChannel: async function(channel, user) {
            try {
                const res = await slack.user.conversations.kick({
                    channel,
                    user
                });
            } catch (err) {
                if (err.data) {
                    if ("user_not_found" == err.data.error || "not_in_channel" == err.data.error) {
                        return { error: "Oops, it looks like this user is not a member of this channel." };
                    } else if ("cant_kick_self" == err.data.error) {
                        return { error: "You can't remove the channel manager from a managed channel." };
                    } else {
                        return { error: `Fatal: unknown platform error - ${err.data.error}` };
                    }
                } else {
                    logger.error(err);
                    return { error: "Fatal: unknown platform error" };
                }
            }
            return {success: "Successfully removed user"}
        },

        setChannelExpiry: async function(channel_id, ts_expiry) {
            return Channel.findByIdAndUpdate(channel_id, {
                ts_expiry,
                reminded: false,
            }).exec();
        },

        requestChannelDialog: async function(trigger_id, data) {
            const { name, user, organization, expire_days, purpose } = data;
            return slack.bot.dialog.open({
                trigger_id,
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
                            hint: "May only contain lowercase letters, " +
                            "numbers, hyphens, and underscores.",
                            value: name || ""
                        },
                        {
                            type: "select",
                            label: "CSM or Account Owner",
                            name: "invitee",
                            data_source: "users",
                            hint: "All channels should include a CSM or " +
                            "account owner. Once a channel is created you " +
                            "can add additional customers.",
                            value: user || ""
                        },
                        {
                            type: "text",
                            label: "Organization/Customer",
                            name: "organization",
                            optional: true,
                            value: organization || ""
                        },
                        {
                            type: "text",
                            subtype: "number",
                            label: "Days until expiry",
                            name: "expire_days",
                            hint: "Enter a positive integer.",
                            value: expire_days || 28
                        },
                        {
                            type: "textarea",
                            label: "Purpose of channel",
                            name: "purpose",
                            optional: true,
                            max_length: 250,
                            value: purpose || ""
                        }
                    ]
                }
            });
        }
    };
};

