// TODO: add search parameters to list_private_channels so that you can filter by organization name
// TODO: notify channel one week in advance of being automatically expired, give them option to
//       extend the expiry
// TODO: add environment variables for hardcoded things in the code
// TODO: add more UI options to make it easier to call the right actions
// TODO: cleanup code and get ready for hosting on heroku (better error handling)
// TODO: comply with https://github.com/DataDog/devops/wiki/Datadog-Open-Source-Policy#releasing-a-new-open-source-repository

const fs = require("fs");
const express = require("express");
const request = require("request");
const lockFile = require("lockfile");
const CronJob = require("cron").CronJob;
const { WebClient } = require("@slack/client");
const { createEventAdapter } = require("@slack/events-api");
const { createMessageAdapter } = require("@slack/interactive-messages");

require("dotenv").config();
const clientId = process.env.SLACK_CLIENT_ID;
const clientSecret = process.env.SLACK_CLIENT_SECRET;
const clientSigningSecret = process.env.SLACK_SIGNING_SECRET;
const port = process.env.PORT || 8080;

const dbFile = "db.json";
const lock = "db.lock";
const oneDay = 1000*60*60*24; // in milliseconds

const slack = new WebClient(process.env.SLACK_TOKEN);
const slackEvents = createEventAdapter(clientSigningSecret);
const slackInteractions = createMessageAdapter(clientSigningSecret);
require("./events.js")(slack, slackEvents);
require("./actions.js")(slack, slackInteractions);

const app = express();
app.use("/event", slackEvents.expressMiddleware());
app.use("/action", slackInteractions.expressMiddleware());

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

app.listen(port, () => {
    console.log("Example app listening on port " + port);

    const expiryJob = new CronJob({
        cronTime: '0 0 * * * *', // runs once every hour
        onTick: () => {
            console.log("Channel expiry job firing now.");
            lockFile.lockSync(lock);
            if (!fs.existsSync(dbFile)) {
                lockFile.unlockSync(lock);
                return;
            }

            const curDate = new Date();
            let channels = JSON.parse(fs.readFileSync(dbFile));
            const oldNumChannels = channels.length;

            channels = channels.filter((channel) => {
                const diff = curDate - new Date(channel.created * 1000);
                if (diff >= (oneDay * channel.expire_days)) {
                    console.log(`#${channel.name} has expired, auto-archiving now.`);
                    slack.conversations.archive({
                        channel: channel.id
                    }).catch(console.error);
                    return false;
                }
                
                if (diff >= (oneDay * (Math.max(channel.expire_days - 7, 0)))) {
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
                return true;
            });

            if (oldNumChannels > channels.length) {
                fs.writeFileSync(dbFile, JSON.stringify(channels));
            }
            lockFile.unlockSync(lock);
        },
        runOnInit: true
    });

    expiryJob.start();
});
