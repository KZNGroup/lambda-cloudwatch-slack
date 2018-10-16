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

var handleElasticBeanstalk = function(event, context) {
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

var handleCodeDeploy = function(event, context) {
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

var handleCodePipeline = function(event, context) {
  var subject = "AWS CodePipeline Notification";
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var snsSubject = event.Records[0].Sns.Subject;
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

var handleElasticache = function(event, context) {
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

var handleCloudWatch = function(event, context) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message = JSON.parse(event.Records[0].Sns.Message);
  var region = event.Records[0].EventSubscriptionArn.split(":")[3];
  var alarmRegion = message.Region;
  var accountId = message.AWSAccountId
  var accountIdMap = JSON.parse(config.awsAccountMap).accounts
  var accountName = message.AWSAccountId;
  var subject = "AWS CloudWatch Notification";
  var alarmName = message.AlarmName;
  var metricName = message.Trigger.MetricName;
  var namespace = message.Trigger.Namespace;
  var dimensions = message.Trigger.Dimensions;
  var dimensionsText = "";
  var oldState = message.OldStateValue;
  var newState = message.NewStateValue;
  var alarmDescription = message.AlarmDescription;
  var alarmReason = message.NewStateReason;
  var trigger = message.Trigger;
  var color = "warning";

  if (message.NewStateValue === "ALARM") {
      color = "danger";
  } else if (message.NewStateValue === "OK") {
      color = "good";
  }
  
  for (var i=0; i< accountIdMap.length; i++) {
    if (accountIdMap[i].accountId === accountId) {
      accountName = accountIdMap[i].name;
      break;
    }
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

var handleConfigCompliance = function(event, context) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message = JSON.parse(event.Records[0].Sns.Message);
  var region = event.Records[0].EventSubscriptionArn.split(":")[3];
  var ruleRegion = message.region;
  var accountId = message.account;
  var accountIdMap = JSON.parse(config.awsAccountMap).accounts
  var accountName = message.AWSAccountId;
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
  
  for (var i=0; i< accountIdMap.length; i++) {
    if (accountIdMap[i].accountId === accountId) {
      accountName = accountIdMap[i].name;
      break;
    }
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

var handleGuardDutyFinding = function(event, context) {
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
  var message = JSON.parse(event.Records[0].Sns.Message);
  var region = event.Records[0].EventSubscriptionArn.split(":")[3];
  var ruleRegion = message.detail.region;
  var accountId = message.detail.accountId;
  var accountIdMap = JSON.parse(config.awsAccountMap).accounts
  var accountName = message.AWSAccountId;
  var subject = "Guard Duty Finding";
  var findingTitle = message.detail.title;
  var findingType = message.detail.type;
  var findingDescription = message.detail.description;
  var findingSeverity = message.detail.severity;
  var findingId = message.detail.id;

  var color = "warning";

  severityHigh = [7,8,7.1,7.2,7.3,7.4,7.5,7.6,7.7,7.8,7.9,8.0,8.1,8.2,8.3,8.4,8.5,8.6,8.7,8.8,8.9];
  severityMedium = [4,5,6,4.0,4.1,4.2,4.3,4.4,4.5,4.6,4.7,4.8,4.9,5.0,5.1,5.2,5.3,5.4,5.5,5.6,5.7,5.8,5.9,6.0,6.1,6.2,6.3,6.4,6.5,6.6,6.7,6.8,6.9]
  severityLow = [0,1,2,3,0.0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.0,2.1,2.2,2.3,2.4,2.5,2.6,2.7,2.8,2.9,3.0,3.1,3.2,3.3,3.4,3.5,3.6,3.7,3.8,3.9]

  if (findingSeverity in severityHigh) {
    color = "danger";
    severity = "High";
  } else if (findingSeverity in severityMedium) {
    color = "warning";
    severity = "Medium";
  } else if (findingSeverity in severityLow) {
    color = "#EAEA23";
    severity = "Low";
  }

  for (var i=0; i< accountIdMap.length; i++) {
    if (accountIdMap[i].accountId === accountId) {
      accountName = accountIdMap[i].name;
      break;
    }
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

var handleAutoScaling = function(event, context) {
  var subject = "AWS AutoScaling Notification"
  var message = JSON.parse(event.Records[0].Sns.Message);
  var timestamp = (new Date(event.Records[0].Sns.Timestamp)).getTime()/1000;
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

var handleCatchAll = function(event, context) {

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

var processEvent = function(event, context) {
  console.log("sns received:" + JSON.stringify(event, null, 2));
  var slackMessage = null;
  var eventSubscriptionArn = event.Records[0].EventSubscriptionArn;
  var eventSnsSubject = event.Records[0].Sns.Subject || 'no subject';
  var eventSnsMessage = event.Records[0].Sns.Message;

  if(eventSubscriptionArn.indexOf(config.services.codepipeline.match_text) > -1 || eventSnsSubject.indexOf(config.services.codepipeline.match_text) > -1 || eventSnsMessage.indexOf(config.services.codepipeline.match_text) > -1){
    console.log("processing codepipeline notification");
    slackMessage = handleCodePipeline(event,context)
  }
  else if(eventSubscriptionArn.indexOf(config.services.elasticbeanstalk.match_text) > -1 || eventSnsSubject.indexOf(config.services.elasticbeanstalk.match_text) > -1 || eventSnsMessage.indexOf(config.services.elasticbeanstalk.match_text) > -1){
    console.log("processing elasticbeanstalk notification");
    slackMessage = handleElasticBeanstalk(event,context)
  }
  else if(eventSubscriptionArn.indexOf(config.services.cloudwatch.match_text) > -1 || eventSnsSubject.indexOf(config.services.cloudwatch.match_text) > -1 || eventSnsMessage.indexOf(config.services.cloudwatch.match_text) > -1){
    console.log("processing cloudwatch notification");
    slackMessage = handleCloudWatch(event,context);
  }
  else if(eventSubscriptionArn.indexOf(config.services.codedeploy.match_text) > -1 || eventSnsSubject.indexOf(config.services.codedeploy.match_text) > -1 || eventSnsMessage.indexOf(config.services.codedeploy.match_text) > -1){
    console.log("processing codedeploy notification");
    slackMessage = handleCodeDeploy(event,context);
  }
  else if(eventSubscriptionArn.indexOf(config.services.elasticache.match_text) > -1 || eventSnsSubject.indexOf(config.services.elasticache.match_text) > -1 || eventSnsMessage.indexOf(config.services.elasticache.match_text) > -1){
    console.log("processing elasticache notification");
    slackMessage = handleElasticache(event,context);
  }
  else if(eventSubscriptionArn.indexOf(config.services.autoscaling.match_text) > -1 || eventSnsSubject.indexOf(config.services.autoscaling.match_text) > -1 || eventSnsMessage.indexOf(config.services.autoscaling.match_text) > -1){
    console.log("processing autoscaling notification");
    slackMessage = handleAutoScaling(event, context);
  }
  else if(eventSubscriptionArn.indexOf(config.services.configcompliance.match_text) > -1 || eventSnsSubject.indexOf(config.services.configcompliance.match_text) > -1 || eventSnsMessage.indexOf(config.services.configcompliance.match_text) > -1){
    console.log("processing config compliance notification");
    slackMessage = handleConfigCompliance(event, context);
  }
  else if(eventSubscriptionArn.indexOf(config.services.guarddutyfinding.match_text) > -1 || eventSnsSubject.indexOf(config.services.guarddutyfinding.match_text) > -1 || eventSnsMessage.indexOf(config.services.guarddutyfinding.match_text) > -1){
    console.log("processing guard duty finding");
    slackMessage = handleGuardDutyFinding(event, context);
  }
  else{
    slackMessage = handleCatchAll(event, context);
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
    var encryptedBuf = new Buffer(config.kmsEncryptedHookUrl, 'base64');
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
