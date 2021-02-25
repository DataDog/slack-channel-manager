/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

// TODO migrate to new workspace API once Slack finishes it
// TODO add `extend` command to extend even after the reminder is over
// TODO comply with https://github.com/DataDog/devops/wiki/Datadog-Open-Source-Policy#releasing-a-new-open-source-repository

const request = require("request");
const express = require("express");
const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate");
const logger = require("heroku-logger");
const CronJob = require("cron").CronJob;
const { WebClient } = require("@slack/client");
const { createEventAdapter } = require("@slack/events-api");
const { createMessageAdapter } = require("@slack/interactive-messages");

require("dotenv").config();
const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;
const clientSigningSecret = process.env.SLACK_SIGNING_SECRET;
const port = process.env.PORT || 8080;

const slack = {
    user: new WebClient(process.env.SLACK_USER_TOKEN),
    bot: new WebClient(process.env.SLACK_BOT_TOKEN)
};
const slackEvents = createEventAdapter(clientSigningSecret);
const slackInteractions = createMessageAdapter(clientSigningSecret, {
    lateResponseFallbackEnabled: true
});

// TODO remove this once mongoose fixes this deprecation
mongoose.set("useFindAndModify", false);
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true });
const ChannelSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    name: { type: String, required: true },
    ts_created: { type: Number, required: true },
    ts_expiry: { type: Number, required: true },
    organization: String,
    topic: String,
    purpose: String,
    reminded: { type: Boolean, default: false }
});
ChannelSchema.plugin(mongoosePaginate);

const app = express();

app.get("/oauth", (req, res) => {
    if (!req.query.code) {
        res.status(500);
        res.send({"Error": "Looks like we are not getting code."});
        logger.error("Invalid OAuth request");
    } else {
        request({
            url: "https://slack.com/api/oauth.access",
            method: "GET",
            qs: {
                code: req.query.code,
                client_id: clientId,
                client_secret: clientSecret
            }
        }, (error, response, body) => {
            if (error) {
                logger.info(error);
            } else {
                res.json(body);
            }
        });
    }
});

app.use("/event", slackEvents.expressMiddleware());
app.use("/action", slackInteractions.expressMiddleware());
app.use("/command", express.urlencoded({ extended: false }));

const Channel = mongoose.model("Channel", ChannelSchema);
const shared = require("./shared.js")(Channel, slack);
require("./events.js")(shared, logger, Channel, slack, slackEvents);
require("./actions.js")(shared, logger, Channel, slack, slackInteractions);
require("./commands.js")(shared, logger, Channel, slack, app);

// catch all error handler
app.use((err, req, res, next) => {
    logger.error(err);
    next(err);
});

const ts_week = 60*60*24*7;
app.listen(port, () => {
    logger.info("Slack Channel Manager server online", { port });
    const expiryJob = new CronJob({
        cronTime: "0 0 0 * * *", // runs once every day at 00:00
        onTick: async () => {
            logger.info("Channel expiry job firing now");
            let channels = [];
            try {
                channels = await Channel.find().exec();
            } catch (err) {
                logger.error(err);
            }

            const ts_curdate = Math.floor(Date.now() / 1000);
            channels.forEach((channel) => {
                if (ts_curdate >= channel.ts_expiry) {
                    logger.info(`#${channel.name} has expired, auto-archiving now.`, { channel: channel.id });
                    slack.user.conversations.archive({ channel: channel.id }).catch(logger.error);
                } else if (!channel.reminded && ts_curdate >= channel.ts_expiry - ts_week) {
                    logger.info(`#${channel.name} will expire within a week`, { channel: channel.id });
                    slack.user.chat.postMessage({
                        channel: channel.id,
                        text: "Looks like this channel will expire _within a " +
                        "week_. You can extend the expiry date by using the " +
                        "`/extend-expiry [number of days]` command in this channel. ",
                        attachments: [{
                            text: "Would you like to extend the expiry date " +
                            "for *one more week*?",
                            fallback: "You are unable to choose an option.",
                            callback_id: "extend_button",
                            color: "warning",
                            attachment_type: "default",
                            actions: [{
                                name: "extend",
                                text: "Extend",
                                type: "button",
                                style: "primary"
                            }]
                        }]
                    }).catch((err) => {
                        if (err.data) {
                            if ("channel_not_found" == err.data.error ||
                                "is_archived" == err.data.error) {
                                logger.error("Channel not found");
                            }
                        } else {
                            logger.error("Fatal: unknown platform error");
                        }
                    });
                    channel.reminded = true;
                    channel.save();
                }
            });
        },
        runOnInit: true
    });

    expiryJob.start();
});
