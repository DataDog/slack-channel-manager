# slack-channel-manager

Slack bot for private channel management in a public slack workspace.

## Usage

Please see the [detailed usage instructions][1] on the project wiki more information.

## Roadmap

Currently, the following features are supported:
- Requesting a private channel for a specific user
- Querying a list of all active channels managed by the bot
- Joining a private channel
- Marking managed channels for automatic expiry
- Managing channels that were manually created by users (unmanaged)

If you would like to see any features implemented (or see any problems with the current functionality), please submit an issue or a pull request.

## Setup Instructions

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. The deployment process will be exactly the same.

### Prerequisites

These dependencies are required before proceeding with a local installation:
- NodeJS and NPM
- MongoDB
- [ngrok][2] (or some secure localhost tunnelling service)

### Installing locally

Clone this repo

```sh
git clone git@github.com:DataDog/slack-channel-manager.git
```

Navigate to the repo and install dependencies

```sh
cd slack-channel-manager
npm install
```

### Running locally

Run the localhost tunnelling service (instructions here are for ngrok on development port 8080).
Note down the <ngrok-subdomain> that appears in the output.

```sh
ngrok http 8080
## You should see the following output if your ngrok account has been setup correctly
# ngrok by @inconshreveable                                                                                                # # # (Ctrl+C to quit)

# Session Status                online
# Account                       <your name> (Plan: Free)
# Version                       2.2.8
# Region                        United States (us)
# Web Interface                 http://127.0.0.1:4040
# Forwarding                    http://<ngrok-subdomain>.ngrok.io -> localhost:8080
# Forwarding                    https://<ngrok-subdomain>.ngrok.io -> localhost:8080
#
# Connections                   ttl     opn     rt1     rt5     p50     p90
#                               0       0       0.00    0.00    0.00    0.00
```

Start up a MongoDB server

```sh
mongod --dbpath=test-data/
```

Run the bot

```
npm start
```

### Setting up the Slack App

Go to your [Slack Apps Dashboard][3] and click on **Create New App**. Make sure not to click on the _Interested in the next generation of apps?_ section. Give the app a name (e.g. `slack-channel-manager`), select a workspace in which you will be testing the bot, and submit the form.

Navigate to the _Interactive Components_ section in the sidebar, then
- Toggle **Interactivity** on
- Set the **Request URL** to `https://<ngrok-subdomain>.ngrok.io/action`
- Add an action with the following fields:

| Name | Description | Callback ID |
| --- | --- | --- |
| Request Private Channel | Request a private channel with a user. | request_channel_action |

Navigate to the _Event Subscriptions_ section in the sidebar, then
- Toggle **Enable Events** on
- Set the **Request URL** to `https://<ngrok-subdomain>.ngrok.io/event`
    - Note that the app must be locally running before setting the Request URL. If everything is correctly configured, a "Verified" icon should appear.
- Under the _Subscribe to Workspace Events_ section, add the following events:

```
group_archive
group_deleted
group_rename
group_unarchive
member_joined_channel
member_left_channel
```

- Under the _Subscribe to Bot Events_ section, add the following events:

```
member_joined_channel
message.im
```

Navigate to the _OAuth and Permissions_ section in the sidebar, then
- Add `https://<ngrok-subdomain>.ngrok.io/oauth` to the _Redirect URLs_ section
- Click on **Select Permission Scopes** and add the following scopes:

```
channels:read
chat:write:bot
groups:read
groups:write
bot
commands
users:read
```

- After saving all changes, click on **Install App to Workspace**

Installing the app to your testing Slack workspace will supply you with all the credentials you need to set up your local environment. The example `.env` file provided in this repository provides instructions on how to set it up.

```
cp .env.example .env
# Follow the instructions inside the new .env file and fill it out
```

Finally, create an "authorization" private channel in your Slack workspace. This channel will be used as a home for all users that are allowed to interact with the Channel Manager. In other words, if a user would like to use the bot, they must be a part of this authorization channel. The name of this channel can be any valid channel name, but it must match the value of `AUTH_CHANNEL` as specified in your `.env` file.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details

[1]: https://github.com/DataDog/slack-channel-manager/wiki/Usage-Instructions
[2]: https://ngrok.com/
[3]: https://api.slack.com/apps/
