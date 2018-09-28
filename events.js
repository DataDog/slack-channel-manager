/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

const helpCommandRegex = /(help|option|action|command|menu)/i;

module.exports = (shared, Channel, slack, slackEvents) => {
    slackEvents.on("message", (event) => {
        // ignore events generated by this bot's responses
        if (event.bot_id) {
            return;
        }
        if (event.message && event.message.bot_id) {
            return;
        }

        const message = event.text.trim().toLowerCase();
        if (helpCommandRegex.test(message)) {
            return slack.bot.chat.postMessage({
                channel: event.channel,
                text: "Here are your options. Type:\n" +
                "- :information_source: | `help`: Print this help message\n" +
                "- :scroll: | `list [keywords ...]`: List active private channels that match your query\n\n" +
                "You can also click on the following options:",
                attachments: [{
                    text: "",
                    fallback: "You are unable to choose an option",
                    callback_id: "menu_button",
                    color: "#3AA3E3",
                    attachment_type: "default",
                    actions: [
                        {
                            name: "request_private_channel",
                            text: "Request a private channel",
                            type: "button"
                        },
                        {
                            name: "list_private_channels",
                            text: "List active private channels",
                            type: "button",
                            value: JSON.stringify({
                                cursor: 0,
                                searchTerms: ""
                            })
                        }
                    ]
                }]
            }).catch(console.error);
        } else if (message.startsWith("list")) {
            const searchTerms = message.replace("list", "").trim().replace(/ /g, "|");
            return shared.listChannels(0, searchTerms).then((reply) => {
                reply.channel = event.channel;
                return slack.bot.chat.postMessage(reply);
            }).catch(console.error);
        } else {
            return slack.bot.chat.postMessage({
                channel: event.channel,
                text: "Hello there, I don't recognize your command. Try typing `help` for more options.",
            }).catch(console.error);
        }
    });

    slackEvents.on("group_renamed", (event) => {
        console.log("event: ", event);
        return;
        Channel.findByIdAndUpdate(event.channel, { name: "" });
    });

    slackEvents.on("group_archive", groupArchive);
    slackEvents.on("group_deleted", groupArchive);

    slackEvents.on("error", console.error);

    function groupArchive(event) {
        Channel.findByIdAndRemove(event.channel)
            .then(() => console.log(`Channel <#${event.channel}> is now inactive and has been removed from the DB.`))
            .catch(console.error);
    }
};
