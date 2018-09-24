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
                if ((curDate - new Date(channel.created * 1000)) >= (oneDay * channel.expire_days)) {
                    console.log(`#${channel.name} has expired, auto-archiving now.`);
                    slack.conversations.archive({
                        channel: channel.id
                    }).catch(console.error);
                    return false;
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
