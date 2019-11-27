/* ***************************************************
 * Reacjilator for Azure Functions with Node.js
 *   Based on https://github.com/slackapi/reacjilator
 * ****************************************************/

 /* Slack App setup
  * Enable events: "reaction_added"
  * Enable Bot user
  * Scopes: "chat:write:bot" (Send messages with chat.postMessage by a bot),
  *         "reactions:read" (Access the workspace’s emoji reaction history)
  *         "*:read" (Access channels info)
  *         "*:history" (Access channels history)
  */

 /* Google Cloud setup
  * API Key https://cloud.google.com/translate/docs/getting-started
  * Node Lib https://www.npmjs.com/package/@google-cloud/translate
  * 
  * Attention:
  *   Set the environment variable GOOGLE_APPLICATION_CREDENTIALS
  *   to the file path of the JSON file that contains your service account key.
  */

 const signature = require('./verifySignature');
 const langcode = require('./langcode');
 const axios = require('axios'); 
 const qs = require('qs');
 
 const apiUrl = 'https://slack.com/api';
 

const googleParams = {
  projectId: process.env.GOOGLE_PROJECT_ID,
  location: process.env.GOOGLE_LOCATION
};

module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request.');
  context.log(`Request data: ${JSON.stringify(req)}`);

  switch (req.body.type) {
    case 'url_verification': {
      // verify Events API endpoint by returning challenge if present
      context.res = {
        body: {challenge: req.body.challenge }
      };
      break;
    }
    case 'event_callback': {
      // Verify the signing secret
      if (!signature.isVerified(req)) {
        context.res = {
          status: 404,
          body: "bad request"
        };
      } else {
        let result = await events(context, req);
        context.res = {
          body: result
        };
      }
      break;
    }
    default: {
      context.res = {
        status: 404,
        body: "bad request"
      };
    }
  }
};

/* Events */

const events = async (context, req) => {
  const {type, user, reaction, item} = req.body.event;
  context.log(`item: ${JSON.stringify(item)}`);

  if (type === 'reaction_added') {
    // If reacji was triggered && it is a correct emoji, translate the message into a specified language
    context.log("Reacji was triggered!");

    if(item.type !== 'message') {
      return;
    }

    let country = '';

    // Check emoji if it is a country flag
    if(reaction.match(/flag-/)) { // when an emoji has flag- prefix
      country = reaction.match(/(?!flag-\b)\b\w+/)[0];
    } else { // jp, fr, etc.
      const flags = Object.keys(langcode); // array
      if(flags.includes(reaction)) {
        country = reaction;
      } else {
        return;
      }
    }

    // Finding a lang based on a country is not the best way but oh well
    // Matching ISO 639-1 language code
    let lang = langcode[country];
    if(!lang) return;

    // Delay to adjust the rise of the function app
    const startTime = Date.now();
    await sleep(Math.random() * 5000);
    context.log(`Delay: ${Date.now() - startTime} [ms]`);

    let messages = await getMessage(context, item.channel, item.ts); 
    context.log(`Messages: ${JSON.stringify(messages)}`);

    await postTranslatedMessage(context, messages, lang, item.channel, reaction);
  }
};

const getMessage = async (context, channel, ts) => { 
  const args = {
    token: process.env.SLACK_ACCESS_TOKEN,
    channel: channel,
    ts: ts,
    limit: 1,
    inclusive: true
  };
  
  const result = await axios.post(`${apiUrl}/conversations.replies`, qs.stringify(args));
  
  try {
    return result.data.messages; 
  } catch(e) {
    context.log(e);
  }
};

// Imports the Google Cloud Translation library
const {TranslationServiceClient} = require('@google-cloud/translate').v3beta1;

// Instantiates a client
const translationClient = new TranslationServiceClient();

const postTranslatedMessage = async (context, messages, lang, channel, emoji) => {

  // Google Translate API
  
  let message = messages[0];
  try {
    // Construct request
    const request = {
      parent: translationClient.locationPath(googleParams.projectId, googleParams.location),
      contents: [message.text],
      mimeType: 'text/plain', // mime types: text/plain, text/html
      targetLanguageCode: lang,
    };

    const [response] = await translationClient.translateText(request);
    context.log(`Trans response: ${JSON.stringify(response)}`);

    let translation = response.translations[0].translatedText;
    if (isAlreadyPosted(messages, translation)) return;
    await postMessage(context, message, translation, lang, channel, emoji);
  } catch(err) {
    context.log(err);
  }
};

const isAlreadyPosted = (messages, translation) => {
  // To avoid posting same messages several times, make sure if a same message in the thread doesn't exist
  let alreadyPosted = false;
  messages.forEach(messageInTheThread => {
    if (!alreadyPosted && messageInTheThread.subtype && messageInTheThread.attachments[0].text === translation) {
      alreadyPosted = true;
    }
  });
  if (alreadyPosted) {
    return true;
  }
};

// Bot posts a message 
const postMessage = async (context, message, translation, lang, channel, emoji) => { 
  let ts = (message.thread_ts) ? message.thread_ts : message.ts;

  // TODO - Once Block Kit supports the "attachment" bar, switch this part to Block Kit!
  
  let attachments = [];
  if(message.text) {
    attachments = [
      {
        pretext: `_The message is translated in_ :${emoji}: _(${lang})_`,
        text: translation,
        footer: message.text,
        mrkdwn_in: ["text", "pretext"]
      }
    ];
  } else {
    attachments = [
      {
        pretext: '_Sorry, the language is not supported!_ :persevere:',
        mrkdwn_in: ["text", "pretext"]
      }
    ];
  }
  
  const args = {
    token: process.env.SLACK_ACCESS_TOKEN,
    channel: channel,
    attachments: JSON.stringify(attachments),
    as_user: false,
    username: 'Reacjilator Bot',
    thread_ts: ts
  };
  
  const result = await axios.post(`${apiUrl}/chat.postMessage`, qs.stringify(args));
  
  try {
    context.log(result.data);
  } catch(e) {
    context.log(e);
  }
};

// Sleep
const sleep = msec => new Promise(resolve => setTimeout(resolve, msec));
