var AWS = require('aws-sdk');
var url = require('url');
var https = require('https');
var config = require('./config');
var _ = require('lodash');
var hookUrl;

var baseSlackMessage = {
  channel: config.slackChannel,
  username: config.slackUsername,
  icon_emoji: config.icon_emoji,
  attachments: [
    {
      "footer": config.orgName,
      "footer_icon": config.orgIcon
    }
  ]
}

const deriveAccountName = function(accountId) {
  const accountIdMap = JSON.parse(config.awsAccountMap).accounts;

  if (accountIdMap) {
    const account = _.find(accountIdMap, { accountId: accountId });
    if (account && account.name) {
      return account.name;
    }
  }

  return accountId;
}

var postMessage = function(message, callback) {
  var body = JSON.stringify(message);
  var options = url.parse(hookUrl);
  options.method = 'POST';
  options.headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  };

  var postReq = https.request(options, function(res) {
    var chunks = [];
    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      return chunks.push(chunk);
    });
    res.on('end', function() {
      var body = chunks.join('');
      if (callback) {
        callback({
          body: body,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage
        });
      }
    });
    return res;
  });

  postReq.write(body);
  postReq.end();
};

var handleElasticBeanstalk = function(event) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var subject = event.Records[0].Sns.Subject || "AWS Elastic Beanstalk Notification";
  var message = event.Records[0].Sns.Message;

  var stateRed = message.indexOf(" to RED");
  var stateSevere = message.indexOf(" to Severe");
  var butWithErrors = message.indexOf(" but with errors");
  var noPermission = message.indexOf("You do not have permission");
  var failedDeploy = message.indexOf("Failed to deploy application");
  var failedConfig = message.indexOf("Failed to deploy configuration");
  var failedQuota = message.indexOf("Your quota allows for 0 more running instance");
  var unsuccessfulCommand = message.indexOf("Unsuccessful command execution");

  var stateYellow = message.indexOf(" to YELLOW");
  var stateDegraded = message.indexOf(" to Degraded");
  var stateInfo = message.indexOf(" to Info");
  var removedInstance = message.indexOf("Removed instance ");
  var addingInstance = message.indexOf("Adding instance ");
  var abortedOperation = message.indexOf(" aborted operation.");
  var abortedDeployment = message.indexOf("some instances may have deployed the new application version");

  var color = "good";

  if (stateRed != -1 || stateSevere != -1 || butWithErrors != -1 || noPermission != -1 || failedDeploy != -1 || failedConfig != -1 || failedQuota != -1 || unsuccessfulCommand != -1) {
    color = "danger";
  }
  if (stateYellow != -1 || stateDegraded != -1 || stateInfo != -1 || removedInstance != -1 || addingInstance != -1 || abortedOperation != -1 || abortedDeployment != -1) {
    color = "warning";
  }

  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "fields": [
          { "title": "Subject", "value": event.Records[0].Sns.Subject, "short": false},
          { "title": "Message", "value": message, "short": false}
        ],
        "color": color,
        "ts":  timestamp
      }
    ]
  };

  return _.merge(slackMessage, baseSlackMessage);
};

var handleCodeDeploy = function(event) {
  var subject = "AWS CodeDeploy Notification";
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var snsSubject = event.Records[0].Sns.Subject;
  var message;
  var fields = [];
  var color = "warning";

  try {
    message = JSON.parse(event.Records[0].Sns.Message);

    if(message.status === "SUCCEEDED"){
      color = "good";
    } else if(message.status === "FAILED"){
      color = "danger";
    }
    fields.push({ "title": "Message", "value": snsSubject, "short": false });
    fields.push({ "title": "Deployment Group", "value": message.deploymentGroupName, "short": true });
    fields.push({ "title": "Application", "value": message.applicationName, "short": true });
    fields.push({
      "title": "Status Link",
      "value": "https://console.aws.amazon.com/codedeploy/home?region=" + message.region + "#/deployments/" + message.deploymentId,
      "short": false
    });
  }
  catch(e) {
    color = "good";
    message = event.Records[0].Sns.Message;
    fields.push({ "title": "Message", "value": snsSubject, "short": false });
    fields.push({ "title": "Detail", "value": message, "short": false });
  }


  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": fields,
        "ts": timestamp
      }
    ]
  };

  return _.merge(slackMessage, baseSlackMessage);
};

var handleCodePipeline = function(event) {
  var subject = "AWS CodePipeline Notification";
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message;
  var fields = [];
  var color = "warning";
  var changeType = "";

  try {
    message = JSON.parse(event.Records[0].Sns.Message);
    detailType = message['detail-type'];

    if(detailType === "CodePipeline Pipeline Execution State Change"){
      changeType = "";
    } else if(detailType === "CodePipeline Stage Execution State Change"){
      changeType = "STAGE " + message.detail.stage;
    } else if(detailType === "CodePipeline Action Execution State Change"){
      changeType = "ACTION";
    }

    if(message.detail.state === "SUCCEEDED"){
      color = "good";
    } else if(message.detail.state === "FAILED"){
      color = "danger";
    }
    header = message.detail.state + ": CodePipeline " + changeType;
    fields.push({ "title": "Message", "value": header, "short": false });
    fields.push({ "title": "Pipeline", "value": message.detail.pipeline, "short": true });
    fields.push({ "title": "Region", "value": message.region, "short": true });
    fields.push({
      "title": "Status Link",
      "value": "https://console.aws.amazon.com/codepipeline/home?region=" + message.region + "#/view/" + message.detail.pipeline,
      "short": false
    });
  }
  catch(e) {
    color = "good";
    message = event.Records[0].Sns.Message;
    header = message.detail.state + ": CodePipeline " + message.detail.pipeline;
    fields.push({ "title": "Message", "value": header, "short": false });
    fields.push({ "title": "Detail", "value": message, "short": false });
  }


  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": fields,
        "ts": timestamp
      }
    ]
  };

  return _.merge(slackMessage, baseSlackMessage);
};

const handleCodeBuild = function(event) {
  const message = JSON.parse(event.Records[0].Sns.Message);

  var color = "warning";
  if (message.detail['build-status'] === "SUCCEEDED"){
    color = "good";
  } else if(message.detail['build-status'] === "IN_PROGRESS"){
    color = "warning";
  } else if(['FAILED', 'STOPPED'].includes(message.detail['build-status'])){
    color = "danger";
  }

  const failedPhase = message.detail['additional-information'].phases.find(p => p['phase-status'] === 'FAILED');
  const error = failedPhase ? failedPhase['phase-context'].join('\n') : '';

  const fields = [
    { "title": "Account", "value": deriveAccountName(message.account), "short": true },
    { "title": "Region", "value": message.region, "short": true },
    { "title": "Project", "value": message.detail['project-name'], "short": true },
    { "title": "Status", "value": message.detail['build-status'], "short": true },
    { "title": "Error", "value": error, "short": false },
    {
      "title": "Status Link",
      "value": message.detail['additional-information'].logs['deep-link'],
      "short": false
    }
  ];

  const slackMessage = {
    text: "*AWS CodeBuild Notification*",
    attachments: [
      {
        "color": color,
        "fields": fields,
        "ts": new Date(event.Records[0].Sns.Timestamp).getTime()/1000
      }
    ]
  };

  return _.merge(slackMessage, baseSlackMessage);
};

var handleElasticache = function(event) {
  var subject = "AWS ElastiCache Notification"
  var message = JSON.parse(event.Records[0].Sns.Message);
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var region = event.Records[0].EventSubscriptionArn.split(":")[3];
  var eventname, nodename;
  var color = "good";

  for(key in message){
    eventname = key;
    nodename = message[key];
    break;
  }
  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": [
          { "title": "Event", "value": eventname.split(":")[1], "short": true },
          { "title": "Node", "value": nodename, "short": true },
          {
            "title": "Link to cache node",
            "value": "https://console.aws.amazon.com/elasticache/home?region=" + region + "#cache-nodes:id=" + nodename + ";nodes",
            "short": false
          }
        ],
        "ts": timestamp
      }
    ]
  };
  return _.merge(slackMessage, baseSlackMessage);
};

var handleCloudWatch = function(event) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message = JSON.parse(event.Records[0].Sns.Message);
  var region = event.Records[0].EventSubscriptionArn.split(":")[3];
  var alarmRegion = message.Region;
  var accountId = message.AWSAccountId
  var accountName = deriveAccountName(accountId);
  var subject = "AWS CloudWatch Notification";
  var alarmName = message.AlarmName;
  var metricName = message.Trigger.MetricName;
  var namespace = message.Trigger.Namespace;
  var dimensions = message.Trigger.Dimensions || [];
  var dimensionsText = "";
  var newState = message.NewStateValue;
  var alarmReason = message.NewStateReason;
  var trigger = message.Trigger;
  var color = "warning";

  if (message.NewStateValue === "ALARM") {
      color = "danger";
  } else if (message.NewStateValue === "OK") {
      color = "good";
  }

  for (var i=0; i < dimensions.length; i++) {
    dimensionsText += dimensions[i].name + '=' + dimensions[i].value;
    if (i < (dimensions.length - 1)) {
      dimensionsText += '; ';
    }
  }

  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": [
          { "title": "Alarm Name", "value": alarmName, "short": true },
          { "title": "Current State", "value": newState, "short": true },
          { "title": "AWS Account", "value": accountName, "short": true },
          { "title": "AWS Region", "value": alarmRegion, "short": true },
          { "title": "Alarm Description", "value": alarmReason, "short": false},
          { "title": "Namespace", "value": namespace, "short": true },
          { "title": "Dimensions", "value": dimensionsText, "short": true },
          {
            "title": "Trigger",
            "value": trigger.Statistic + " "
              + metricName + " "
              + trigger.ComparisonOperator + " "
              + trigger.Threshold + " for "
              + trigger.EvaluationPeriods + " period(s) of "
              + trigger.Period + " seconds.",
              "short": false
          },
          {
            "title": "Link to Alarm",
            "value": "https://console.aws.amazon.com/cloudwatch/home?region=" + region + "#alarm:alarmFilter=ANY;name=" + encodeURIComponent(alarmName),
            "short": false
          }
        ],
        "ts":  timestamp
      }
    ]
  };
  return _.merge(slackMessage, baseSlackMessage);
};

var handleConfigCompliance = function(event) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message = JSON.parse(event.Records[0].Sns.Message);
  var ruleRegion = message.region;
  var accountId = message.account;
  var accountName = deriveAccountName(accountId);
  var subject = "AWS Config Rule Compliance State Change Notification";
  var configRuleName = message.detail.configRuleName;
  var resourceType = message.detail.resourceType;
  var resourceId = message.detail.resourceId;
  var newComplianceType = message.detail.newEvaluationResult.complianceType;
  var color = "warning";

  if (newComplianceType === "NON_COMPLIANT") {
      color = "danger";
  } else if (newComplianceType === "COMPLIANT") {
      color = "good";
  }
  
  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": [
          { "title": "Config Rule Name", "value": configRuleName, "short": true },
          { "title": "Compliance State", "value": newComplianceType, "short": true },
          { "title": "AWS Account", "value": accountName, "short": true },
          { "title": "AWS Region", "value": ruleRegion, "short": true },
          { "title": "Resource Type", "value": resourceType, "short": true},
          { "title": "Resource", "value": resourceId, "short": true },
          {
            "title": "Link to Rule",
            "value": "https://console.aws.amazon.com/config/home?region=" + ruleRegion + "#rules/rules/rule-details/" + encodeURIComponent(configRuleName),
            "short": false
          }
        ],
        "ts":  timestamp
      }
    ]
  };
  return _.merge(slackMessage, baseSlackMessage);
};

var handleGuardDutyFinding = function(event) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message = JSON.parse(event.Records[0].Sns.Message);
  var ruleRegion = message.detail.region;
  var accountId = message.detail.accountId;
  var accountName = deriveAccountName(accountId);
  var subject = "Guard Duty Finding";
  var findingTitle = message.detail.title;
  var findingType = message.detail.type;
  var findingDescription = message.detail.description;
  var findingSeverity = message.detail.severity;
  var findingId = message.detail.id;

  var color = "warning";
  var severity = "unknown";

  if (findingSeverity >= 0.0 && findingSeverity <= 3.9) {
    color = "#EAEA23";
    severity = "Low";
  } else if (findingSeverity >= 4.0 && findingSeverity <= 6.9) {
    color = "warning";
    severity = "Medium";
  } else if (findingSeverity >= 7.0 && findingSeverity <= 8.9) {
    color = "danger";
    severity = "High";
  }

  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": [
          { "title": "Finding Type", "value": findingType, "short": true },
          { "title": "Severity", "value": findingSeverity + " (" + severity + ")", "short": true },
          { "title": "AWS Account", "value": accountName, "short": true },
          { "title": "AWS Region", "value": ruleRegion, "short": true },
          { "title": "Finding", "value": findingTitle, "short": false },
          { "title": "Description", "value": findingDescription, "short": false },
          {
            "title": "Link to Finding",
            "value": "https://console.aws.amazon.com/guardduty/home?region=" + ruleRegion + "#/findings?macros=current&fId=" + encodeURIComponent(findingId),
            "short": false
          }
        ],
        "ts":  timestamp
      }
    ]
  };
  return _.merge(slackMessage, baseSlackMessage);
};

var handleAutoScaling = function(event) {
  var subject = "AWS AutoScaling Notification"
  var message = JSON.parse(event.Records[0].Sns.Message);
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var color = "good";

  for(key in message){
    eventname = key;
    nodename = message[key];
    break;
  }
  var slackMessage = {
    text: "*" + subject + "*",
    attachments: [
      {
        "color": color,
        "fields": [
          { "title": "Message", "value": event.Records[0].Sns.Subject, "short": false },
          { "title": "Description", "value": message.Description, "short": false },
          { "title": "Event", "value": message.Event, "short": false },
          { "title": "Cause", "value": message.Cause, "short": false }

        ],
        "ts": timestamp
      }
    ]
  };
  return _.merge(slackMessage, baseSlackMessage);
};

var handleCatchAll = function(event) {

    var record = event.Records[0]
    var subject = record.Sns.Subject
    var timestamp = new Date(record.Sns.Timestamp).getTime() / 1000;
    var message = JSON.parse(record.Sns.Message)
    var color = "warning";

    if (message.NewStateValue === "ALARM") {
        color = "danger";
    } else if (message.NewStateValue === "OK") {
        color = "good";
    }

    // Add all of the values from the event message to the Slack message description
    var description = ""
    for(key in message) {

        var renderedMessage = typeof message[key] === 'object'
                            ? JSON.stringify(message[key])
                            : message[key]

        description = description + "\n" + key + ": " + renderedMessage
    }

    var slackMessage = {
        text: "*" + subject + "*",
        attachments: [
          {
            "color": color,
            "fields": [
              { "title": "Message", "value": record.Sns.Subject, "short": false },
              { "title": "Description", "value": description, "short": false }
            ],
            "ts": timestamp
          }
        ]
    }

  return _.merge(slackMessage, baseSlackMessage);
}

// loosely matches whether the matchText is anywhere in the subject, body or SNS topic ARN.
const eventMatches = function(event, matchText) {
  const eventSubscriptionArn = event.Records[0].EventSubscriptionArn;
  const eventSnsSubject = event.Records[0].Sns.Subject || 'no subject';
  const eventSnsMessage = event.Records[0].Sns.Message;

  return eventSubscriptionArn.includes(matchText)
          || eventSnsSubject.includes(matchText)
          || eventSnsMessage.includes(matchText);
}

// strictly matches the source of the event.
const eventMatchesSource = function(event, matchText) {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    return message.source === matchText;
  } catch(e) {
    return false;
  }
}

var processEvent = function(event, context) {
  console.log("sns received:" + JSON.stringify(event, null, 2));
  var slackMessage = null;

  if (eventMatchesSource(event, config.services.codepipeline.match_text)) {
    console.log("processing codepipeline notification");
    slackMessage = handleCodePipeline(event)
  } else if(eventMatches(event, config.services.codebuild.match_text)) {
    console.log("processing codebuild notification");
    slackMessage = handleCodeBuild(event)
  } else if(eventMatches(event, config.services.elasticbeanstalk.match_text)) {
    console.log("processing elasticbeanstalk notification");
    slackMessage = handleElasticBeanstalk(event)
  } else if(eventMatches(event, config.services.cloudwatch.match_text)) {
    console.log("processing cloudwatch notification");
    slackMessage = handleCloudWatch(event);
  } else if(eventMatches(event, config.services.codedeploy.match_text)) {
    console.log("processing codedeploy notification");
    slackMessage = handleCodeDeploy(event);
  } else if(eventMatches(event, config.services.elasticache.match_text)) {
    console.log("processing elasticache notification");
    slackMessage = handleElasticache(event);
  } else if(eventMatches(event, config.services.autoscaling.match_text)) {
    console.log("processing autoscaling notification");
    slackMessage = handleAutoScaling(event);
  } else if(eventMatches(event, config.services.configcompliance.match_text)) {
    console.log("processing config compliance notification");
    slackMessage = handleConfigCompliance(event);
  } else if(eventMatches(event, config.services.guarddutyfinding.match_text)) {
    console.log("processing guard duty finding");
    slackMessage = handleGuardDutyFinding(event);
  } else {
    slackMessage = handleCatchAll(event);
  }

  postMessage(slackMessage, function(response) {
    if (response.statusCode < 400) {
      console.info('message posted successfully');
      context.succeed();
    } else if (response.statusCode < 500) {
      console.error("error posting message to slack API: " + response.statusCode + " - " + response.statusMessage);
      // Don't retry because the error is due to a problem with the request
      context.succeed();
    } else {
      // Let Lambda retry
      context.fail("server error when processing message: " + response.statusCode + " - " + response.statusMessage);
    }
  });
};

exports.handler = function(event, context) {
  if (hookUrl) {
    processEvent(event, context);
  } else if (config.unencryptedHookUrl) {
    hookUrl = config.unencryptedHookUrl;
    processEvent(event, context);
  } else if (config.kmsEncryptedHookUrl && config.kmsEncryptedHookUrl !== '<kmsEncryptedHookUrl>') {
    var encryptedBuf = Buffer.from(config.kmsEncryptedHookUrl, 'base64');
    var cipherText = { CiphertextBlob: encryptedBuf };
    var kms = new AWS.KMS();

    kms.decrypt(cipherText, function(err, data) {
      if (err) {
        console.log("decrypt error: " + err);
        processEvent(event, context);
      } else {
        hookUrl = "https://" + data.Plaintext.toString('ascii');
        processEvent(event, context);
      }
    });
  } else {
    context.fail('hook url has not been set.');
  }
};
