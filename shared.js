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

module.exports = (Channel, slack) => {
    return {
        isUserAuthorized: async function(user) {
            let cursor = "";
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

        // NOTE: this relies on the fact that the conversations.list API sorts
        // returned channels by name
        // api_cursor is the offset/cursor used to request channels from Slack's API
        // sub_offset is the offset used to select channels from a response of Slack's API onwards
        listUnmanaged: async function(api_cursor, sub_offset) {
            const limit = 100;
            let allUnmanaged = [];
            const old_cursor = api_cursor;
            const old_offset = sub_offset;

            let i;
            let res;
            do {
                res = await slack.user.conversations.list({
                    limit,
                    types: "private_channel",
                    exclude_archived: true,
                    cursor: api_cursor
                });
                console.log(res.channels);

                const ids = res.channels.map(channel => channel.id);
                const managedChannels = await Channel.find({ _id: { $in: ids } }).exec();
                const managedIds = managedChannels.map(channel => channel.id);
                console.log("managedIds: ", managedIds);

                for (
                    i = sub_offset;
                    (i < res.channels.length) && (allUnmanaged.length < 5);
                    ++i
                ) {
                    const channel = res.channels[i];
                    if (-1 == managedIds.indexOf(channel.id)) {
                        allUnmanaged.push(channel);
                    }
                }
                api_cursor = res.response_metadata.next_cursor;
                sub_offset = 0;
            } while (api_cursor && (allUnmanaged.length < 5));

            if (0 == allUnmanaged.length) {
                return {
                    text: "Hooray! There are no more unmanaged private channels left in the workspace."
                };
            }

            let attachments = [];
            allUnmanaged.forEach((channel) => {
                let text = "";
                if (channel.topic.value) {
                    text += `_${channel.topic.value}_`;
                }
                if (channel.purpose.value) {
                    text += "\n" + channel.purpose.value;
                }

                attachments.push({
                    title: `#${channel.name}`,
                    text,
                    callback_id: "unmanaged_channel_button",
                    actions: [{
                        name: "add_channel_manager",
                        text: "Add Channel Manager",
                        type: "button",
                        style: "primary",
                        value: channel.id
                    }],
                    footer: "Date created",
                    ts: channel.created,
                    mrkdwn: true
                });
            });

            let actions = [];
            if (old_cursor) {
                actions.push({
                    name: "list_unmanaged",
                    text: "Prev page",
                    type: "button",
                    value: JSON.stringify({
                        api_cursor: old_cursor,
                        sub_offset: old_offset
                    })
                });
            }
            if (api_cursor) {
                actions.push({
                    name: "list_unmanaged",
                    text: "Next page",
                    type: "button",
                    value: JSON.stringify({
                        api_cursor,
                        sub_offset: i % 5
                    })
                });
            }
            if (limit == res.channels.length) {
                attachments.push({
                    text: "See more channels...",
                    callback_id: "admin_button",
                    actions
                });
            }

            return {
                text: "Here is a list of unmanaged active private channels.",
                attachments
            };


        },

        listChannels: async function(offset, searchTerms) {
            const query = (!searchTerms) ? {} : {
                $or: [
                    { name: { $regex: searchTerms, $options: "i" } },
                    { organization: { $regex: searchTerms, $options: "i" } }
                ]
            };
            const paginatedData = await Channel.paginate(query, { offset, limit: 5 });
            const channels = paginatedData.docs;
            if (0 == channels.length) {
                return {
                    text: "There are no active private channels that match your query, " +
                    "type `help` if you would like to request one."
                };
            }

            let attachments = [];
            channels.forEach((channel) => {
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
            });

            let actions = [];
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
            if (paginatedData.total > 5) {
                attachments.push({
                    text: "See more channels...",
                    callback_id: "menu_button",
                    actions
                });
            }

            return {
                text: "Here is a `list` of active private channels that match your query:",
                attachments
            };
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
                            hint: "May only contain lowercase letters, numbers, hyphens, and underscores.",
                            value: name || ""
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
                            optional: true,
                            value: organization || ""
                        },
                        {
                            type: "text",
                            subtype: "number",
                            label: "Days until expiry",
                            name: "expire_days",
                            hint: "Enter a positive integer.",
                            value: expire_days || 14
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

