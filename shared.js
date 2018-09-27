/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

module.exports = (Channel, slack) => {
    return {
        listChannels: async function(cursor, searchTerms) {
            let query = Channel.find();
            if (searchTerms) {
                query = query.or([
                    { name: { $regex: searchTerms, $options: "i" } },
                    { organization: { $regex: searchTerms, $options: "i" } }
                ]);
            }
            query = query.skip(cursor || 0).limit(5);

            const channels = await query.exec();
            if (0 == channels.length) {
                return {
                    text: "There are currently no active private channels right now, " +
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
            if (cursor >= 5) {
                actions.push({
                    name: "list_private_channels",
                    text: "Prev page",
                    type: "button",
                    value: JSON.stringify({
                        cursor: cursor - 5,
                        searchTerms
                    })
                });
            }
            if (cursor + 5 < channels.length) {
                actions.push({
                    name: "list_private_channels",
                    text: "Next page",
                    type: "button",
                    value: JSON.stringify({
                        cursor: cursor + 5,
                        searchTerms
                    })
                });
            }
            if (channels.length > 5) {
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
        }
    };
};

