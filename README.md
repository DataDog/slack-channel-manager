# slack-channel-manager

Slack bot for private channel management in a public slack workspace.

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. The deployment process will be exactly the same.

### Prerequisites

These dependencies are required before proceeding with a local installation:
- NodeJS and NPM
- MongoDB
- [ngrok][1] (or some secure localhost tunnelling service)

### 1. Installing locally

Clone this repo

```sh
git clone git@github.com:DataDog/slack-channel-manager.git
```

Navigate to the repo and install dependencies

```sh
cd slack-channel-manager
npm install
```

### 2. Running locally

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

### 2. Setting up the Slack App

Go to your [Slack Apps Dashboard][2] and click on **Create New App**. Make sure not to click on the _Interested in the next generation of apps?_ section. Give the app a name (e.g. `slack-channel-manager`), select a workspace in which you will be testing the bot, and submit the form.

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

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

[1]: https://ngrok.com/
[2]: https://api.slack.com/apps/
