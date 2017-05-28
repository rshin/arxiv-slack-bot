// Partially derived from https://github.com/joebullard/slack-arxivbot.

// "Verification token" under Basic Information
const APP_TOKEN = 'NEEDS TO BE SET';
// "OAuth Access Token" under OAuth & Permissions
const OAUTH_TOKEN = 'NEEDS TO BE SET';

var Promise = require('bluebird');
var rp = require('request-promise');
var parseString = Promise.promisify(require('xml2js').parseString);

const ARXIV_ID   = /\d{4}\.\d{4,5}/;
const ARXIV_LINK = /(?:https?:\/\/)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:.pdf)?/g;
const ARXIV_API_URL = 'http://export.arxiv.org/api/query?search_query=id:';

const fetchArxiv = function (arxivId, callback) {
  return rp(ARXIV_API_URL + arxivId).then(parseApiResponseBody);
};

const parseApiResponseBody = function (body) {
  return parseString(body).then(result => {
    if (!result.feed.entry) {
      throw new Error('ArXiv entry not found');
    }
    var entry = result.feed.entry[0];
    return {
      id      : entry.id ?
                entry.id[0].split('/').pop() :
                '{No ID}',
      url     : entry.id ?
                entry.id[0] :
                '{No url}',
      title   : entry.title ?
                entry.title[0].trim().replace(/\n/g, ' ') :
                '{No title}',
      summary : entry.summary ?
                entry.summary[0].trim().replace(/\n/g, ' ') :
                '{No summary}',
      authors : entry.author ?
                entry.author.map(function (a) { return a.name[0]; }) :
                '{No authors}',
      categories : entry.category ? entry.category.map(c => c.$.term) : [],
      updated_time : Date.parse(entry.updated) / 1000,
    };
  });
}

const formatArxivAsAttachment = function (arxivData) {
  return {
    author_name: arxivData.authors.join(', '),
    title      : '[' + arxivData.id + '] ' + arxivData.title,
    title_link : arxivData.url,
    text       : arxivData.summary,
    footer     : arxivData.categories.join(', '),
    footer_icon: 'https://arxiv.org/favicon.ico',
    ts         : arxivData.updated_time,
    color      : '#b31b1b',
  };
}


exports.arxivBot = function arxivBot(req, res) {
  if (req.body.token !== APP_TOKEN) {
    res.status(403).send('Invalid token');
    return;
  }
  
  if (req.body.type === 'url_verification') {
    res.send(req.body.challenge);
  } else if (req.body.type === 'event_callback' && req.body.event.type == 'link_shared') {
    res.send('ok');
    
    const event = req.body.event;
    var unfurls = {};
    
    Promise.map(event.links, link => {
      if (link.domain !== 'arxiv.org') {
        throw new Error('incorrect link.domain: ' + link.domain);
      }
      return fetchArxiv(link.url.match(ARXIV_ID)[0]).then(arxiv => {
        unfurls[link.url] = formatArxivAsAttachment(arxiv);
      });
    }).then(() => {
      return rp.post({
        url: 'https://slack.com/api/chat.unfurl',
        form: {
          token: OAUTH_TOKEN,
          channel: event.channel,
          ts: event.message_ts,
          unfurls: JSON.stringify(unfurls)
        },
      });
    }).catch(err => {
      console.log('error:', err);
    });
  } else {
    res.status(400).send('Unknown request');
  }
}