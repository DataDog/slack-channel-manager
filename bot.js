/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

// TODO: add `extend` command to extend even after the reminder is over
// TODO: stop reminding people in a channel after the expiry week has started
// TODO: cleanup code and get ready for hosting on heroku (better error handling)
// TODO: comply with https://github.com/DataDog/devops/wiki/Datadog-Open-Source-Policy#releasing-a-new-open-source-repository

const https = require("https");
const request = require("request");
const express = require("express");
const mongoose = require("mongoose");
const CronJob = require("cron").CronJob;
const { WebClient } = require("@slack/client");
const { createEventAdapter } = require("@slack/events-api");
const { createMessageAdapter } = require("@slack/interactive-messages");

require("dotenv").config();
const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;
const clientSigningSecret = process.env.SLACK_SIGNING_SECRET;
const port = process.env.PORT || 8080;

const oneDay = 1000*60*60*24; // in milliseconds

const slack = new WebClient(process.env.SLACK_TOKEN);
const slackEvents = createEventAdapter(clientSigningSecret);
const slackInteractions = createMessageAdapter(clientSigningSecret, {
    lateResponseFallbackEnabled: true
});

mongoose.set('useFindAndModify', false);
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true });
const ChannelSchema = new mongoose.Schema({
    _id: String,
    name: String,
    created: Number,
    user: String,
    organization: String,
    topic: String,
    purpose: String,
    expire_days: Number
});
const Channel = mongoose.model("Channel", ChannelSchema);

const shared = require("./shared.js")(Channel, slack);
require("./events.js")(shared, Channel, slack, slackEvents);
require("./actions.js")(shared, Channel, slack, slackInteractions);

const app = express();

app.get("/oauth", (req, res) => {
    if (!req.query.code) {
        res.status(500);
        res.send({"Error": "Looks like we are not getting code."});
        console.log("Looks like we are not getting code.");
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
                console.log(error);
            } else {
                res.json(body);
            }
        });
    }
});

app.use("/event", slackEvents.expressMiddleware());
app.use("/action", slackInteractions.expressMiddleware());

// catch all error handler
app.use(function(err, req, res, next) {
    console.error(err.stack);
    next(err);
});

app.listen(port, function () {
    console.log("Server started, listening on port " + port);
    const expiryJob = new CronJob({
        // cronTime: '0 0 * * * *', // runs once every hour
        cronTime: '0 0 0 * * *', // runs once every day
        onTick: () => {
            console.log("Channel expiry job firing now.");
            Channel.find().exec()
            .then((channels) => {
                const curDate = new Date();

                channels.forEach((channel) => {
                    const diff = curDate - new Date(channel.created * 1000);
                    if (diff >= (oneDay * channel.expire_days)) {
                        console.log(`#${channel.name} has expired, auto-archiving now.`);
                        slack.conversations.archive({
                            channel: channel.id
                        }).catch(console.error);
                    } else if (diff >= (oneDay * (Math.max(channel.expire_days - 7, 0)))) {
                        console.log(`#${channel.name} will expire within a week.`);
                        slack.chat.postMessage({
                            channel: channel.id,
                            text: "Looks like this channel will _expire within a week_, " +
                            "would you like to *extend it for one more week*?",
                            attachments: [{
                                text: "",
                                fallback: "You are unable to choose an option.",
                                callback_id: "expire_warning_button",
                                color: "warning",
                                attachment_type: "default",
                                actions: [
                                    {
                                        name: "yes",
                                        text: "Yes",
                                        type: "button",
                                        style: "primary"
                                    },
                                    {
                                        name: "no",
                                        text: "No",
                                        type: "button"
                                    }
                                ]
                            }]
                        }).catch(console.error);
                    }
                });
            });
        },
        runOnInit: false
    });

    expiryJob.start();
});
