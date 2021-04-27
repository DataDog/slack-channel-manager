/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

const user_id_regex = /^<@([A-Z0-9]+)\|.+>$/;

module.exports = (shared, logger, Channel, slack, app) => {
    app.post("/command/request-channel", async (req, res) => {
        let user_id = "";
        if (req.body.text) {
            const match = req.body.text.match(user_id_regex);
            if (match) {
                user_id = match[1];
            }
        }

        shared.requestChannelDialog(req.body.trigger_id, { user: user_id });
        res.send(":building_construction: Requesting private channel...");
    });

    app.post("/command/extend-expiry", async (req, res) => {
        if (!req.body.text) {
            return res.send({
                text: "You didn't specify a number of days to extend the " +
                "expiry date by.",
                attachments: [{
                    text: "Would you like to extend the expiry date " +
                    "by *one week*?",
                    fallback: "You are unable to choose an option.",
                    callback_id: "extend_button",
                    attachment_type: "default",
                    actions: [{
                        name: "extend",
                        text: "Extend",
                        type: "button",
                        style: "primary"
                    }]
                }]
            });
        }

        const numDays = parseInt(req.body.text);
        if (!numDays || numDays <= 0) {
            return res.send(
                "Oops, you didn't specify a valid positive " +
                "integer, please try that again."
            );
        }

        const channel = await shared.extendChannelExpiry(req.body.channel_id, numDays);
        if (!channel) {
            return res.send(
                "That command won't work here because this channel isn't " +
                "managed by me. Type `help` in my chat for more information."
            );
        }

        return res.send(
            ":white_check_mark: Successfully extended this channel's " +
            `expiry date by ${numDays} day(s)`
        );
    });

    app.post("/command/remove-user", async (req, res) => {
        if (!req.body.text) {
            return res.send({
                text: ":no_entry_sign: You didn't specify a user to remove"
            });
        }
        const user_to_remove = req.body.text
        const regex = /<@([^|]*)\|/
        const user_regex_result = user_to_remove.match(regex)
        if (!user_regex_result || user_regex_result.length !== 2 || !user_regex_result[1]) {
            return res.send({
                text: ":no_entry_sign: Invalid user specified, please use @handle"
            });
        }
        const user_id = user_regex_result[1]
        const channel = await shared.isManagedChannel(req.body.channel_id)
        if (!channel) {
            return res.send(
                "That command won't work here because this channel isn't " +
                "managed by me. Type `help` in my chat for more information."
            );
        }
        const result = await shared.removeUserFromChannel(req.body.channel_id, user_id);
        if ('error' in result) {
            return res.send(
                    `:no_entry_sign: ${result.error}`
                );
        } else {
            return res.send(`:white_check_mark: ${result.success}`)
        }
    });

    app.post("/command/set-expiry", async (req, res) => {
        // Date.parse returns milliseconds from epoch
        const expiry_date = Date.parse(req.body.text);
        if (!expiry_date || expiry_date < Date.now()) {
            return res.send(
                "Please specify a valid future expiry date in YYYY-MM-DD format."
            );
        }

        const ts_expiry = Math.floor(expiry_date / 1000);
        const channel = await shared.setChannelExpiry(
            req.body.channel_id,
            ts_expiry
        );

        if (!channel) {
            return res.send(
                "That command won't work here because this channel isn't " +
                "managed by me. Type `help` in my chat for more information."
            );
        }

        return res.send(
            ":white_check_mark: OK, this channel will now expire on " +
            `${req.body.text} at 00:00 UTC.`
        );
    });
};
