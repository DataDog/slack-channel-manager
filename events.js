const fs = require("fs");
const lockFile = require("lockfile");
const botId = process.env.SLACK_BOT_ID;
const dbFile = "db.json";
const lock = "db.lock";
const helpCommandRegex = /(help|option|action|command|menu)/i;

module.exports = (shared, slack, slackEvents) => {
    slackEvents.on("message", (event) => {
        // ignore events generated by this bot's responses
        if (event.bot_id && botId == event.bot_id) {
            return;
        }
        if (event.message && event.message.bot_id && (botId == event.message.bot_id)) {
            return;
        }

        const message = event.text.trim().toLowerCase();
        if (helpCommandRegex.test(message)) {
            return slack.chat.postMessage({
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
            return shared.listChannels(0, searchTerms).then((result) => {
                const { text, attachments } = result.data;
                return slack.chat.postMessage({
                    channel: event.channel,
                    text,
                    attachments
                });
            });
        } else {
            return slack.chat.postMessage({
                channel: event.channel,
                text: "Hello there, I don't recognize your command. Try typing `help` for more options.",
            }).catch(console.error);
        }
    });

    slackEvents.on("group_archive", (event) => {
        lockFile.lockSync(lock);
        if (!fs.existsSync(dbFile)) {
            lockFile.unlockSync(lock);
            return;
        }

        let channels = JSON.parse(fs.readFileSync(dbFile));
        for (let i = 0; i < channels.length; ++i) {
            if (channels[i].id == event.channel) {
                channels.splice(i, 1);
                break;
            }
        }

        fs.writeFileSync(dbFile, JSON.stringify(channels));
        lockFile.unlockSync(lock);
    });

    slackEvents.on("error", console.error);
};
