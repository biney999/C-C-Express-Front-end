var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express(); 

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// Required imports and configurations
const AWS = require("aws-sdk");
require("dotenv").config();
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const { getSignedUrl} = require('@aws-sdk/s3-request-presigner');

AWS.config.update({
  region: 'ap-southeast-2'
});
var ddb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

app.get("/", (req, res) => {
  res.render("index.html");
});

// Create a presigned URL function
const createPresignedUrlWithClient = ({ region, bucket, key }) => {
  const client = new S3Client({ region });
  const command = new PutObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: 3600 }, { ContentType: 'application/octet-stream' });
};

// Route to generate pre-Signed URL with items
app.post('/generate-presigned-url', async (req, res) => {
  const REGION = "ap-southeast-2";
  const BUCKET = "Bucket_Name";
  const fileName = req.body.fileName;
  const KEY = fileName;
  try {
    const clientUrl = await createPresignedUrlWithClient({
      region: REGION,
      bucket: BUCKET,
      key: KEY
    });
    console.log("Calling PUT using presigned URL with client");
    res.json({ uploadURL: clientUrl });
    console.log(clientUrl);
  } catch (err) {
    console.error(err);
  }
});

// Route for processing with timestamp as session ID
app.post('/processing/:timestamp', async (req, res) => {
  var sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
  const fileName = req.body.fileName;
  const uploadURL = req.body.uploadURL;
  const selectedOutputFormat = req.body.selectedOutputFormat;
  try {
    // Message with name and URL
    const sqsMessage = {
      fileName,
      uploadURL,
      selectedOutputFormat
    };
    const params = {
      MessageBody: JSON.stringify(sqsMessage), // Convert the message to to JSON
      QueueUrl: "SQS_URL", // SQS queue URL
    };
    sqs.sendMessage(params, function (err, data) {
      if (err) {
        console.log("Error", err);
      } else {
        console.log("Success", data.MessageId);
        const newnameFile = "transformed_" + fileName.split('.').slice(0, -1).join('.') + "." + selectedOutputFormat; // Transformed file name to be searched
        pollDynamoDB(newnameFile, res); // Poll DynamoDB for objects
      }
    });

  } catch (err) {
    console.error(err);
  }

  // Function to poll dynamoDB after files are sent to the Worker
  function pollDynamoDB(newnameFile, res) {
    // Search for the newly transformed file
    var DynaParams = {
      TableName: 'table-name',
      Key: {
        'username': { S: 'My-Username :))' },
        'TransformFile': { S: newnameFile }
      },
      ProjectionExpression: 'TransformFile, Link'
    };

    ddb.getItem(DynaParams, function (err, data) {
      if (err) {
        console.log("Errorz", err);
        res.status(500).send({ error: 'DynamoDB read failed' });
      }
      // Retrieves download link if items are found and Transformed file name table is detected and the item matches the new File Name
      else if (data.Item && data.Item.TransformFile && data.Item.TransformFile.S === newnameFile) {
        console.log("Successful recovery");
        finalLink = data.Item.Link.S;
        res.status(200).json({ finalLink });
      } else {
        // Poll every 1 second if not found
        setTimeout(() => pollDynamoDB(newnameFile, res), 1000);
      }
    });
  }
});

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;