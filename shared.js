/**
 * Unless explicitly stated otherwise all files in this repository are licensed
 * under the MIT License.
 *
 * This product includes software developed at Datadog
 * (https://www.datadoghq.com/).
 *
 * Copyright 2018 Datadog, Inc.
 */

const fs = require("fs");
const lockFile = require("lockfile");
const dbFile = "db.json";
const lock = "db.lock";

module.exports = (slack) => {
    return {
        processChannels: async function(cb) {
            return new Promise((resolve, reject) => {
                lockFile.lock(lock, (err) => {
                    if (err) {
                        return reject(err);
                    }

                    if (fs.existsSync(dbFile)) {
                        fs.readFile(dbFile, (err, data) => {
                            if (err) {
                                return reject(err);
                            }

                            resolve(data);
                        });
                    } else {
                        fs.writeFile(dbFile, "[]", (err) => {
                            if (err) {
                                return reject(err);
                            }

                            resolve("[]");
                        });
                    }
                });
            }).then((data) => {
                return cb(JSON.parse(data));
            }).then((cbResult) => {
                if (cbResult.writeBack) {
                    return new Promise((resolve, reject) => {
                        fs.writeFile(dbFile, JSON.stringify(cbResult.channels), (err) => {
                            if (err) {
                                return reject(err);
                            }

                            resolve(cbResult);
                        });
                    });
                } else {
                    return cbResult;
                }
            }).then((cbResult) => {
                return new Promise((resolve, reject) => {
                    lockFile.unlock(lock, (err) => {
                        if (err) {
                            return reject(err);
                        }
                        resolve(cbResult);
                    });
                });
            });
        },

        listChannels: async function(cursor, searchTerms) {
            return this.processChannels((channels) => {
                if (0 == channels.length) {
                    return {
                        channels,
                        data: {
                            text: "There are currently no active private channels right now, " +
                            "type `help` if you would like to request one."
                        }
                    };
                }

                if (searchTerms) {
                    const searchRegex = new RegExp(searchTerms, "i");
                    channels = channels.filter((channel) => {
                        return searchRegex.test(channel.name + channel.organization);
                    });
                }
                let attachments = [];
                for (let i = cursor || 0; i < Math.min(cursor + 5, channels.length); ++i) {
                    const channel = channels[i];
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
                }

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
                    channels,
                    data: {
                        text: "Here is a `list` of active private channels that match your query:",
                        attachments
                    }
                };
            });
        }
    };
};

