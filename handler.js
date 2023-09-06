'use strict';
const { S3Client, GetObjectCommand, ListObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const https = require("https");
const { createDeployment } = require('@vercel/client');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const os = require('os');
const { parse } = require("url");

const s3Client = new S3Client(
  {
    region: YOUR_AWS_REGION,
    credentials: {
      accessKeyId: YOUR_AWS_ACCESS_KEY,
      secretAccessKey: YOUR_AWS_SECRET_KEY,
    },
});

module.exports.deployNextJsAppToVercel  = async (event, context) => {
  const token = YOUR_VERCEL_TOKEN;
  const projectName = event.Records[0].s3.object.key.split("/")[0];
  // For local testing
  // const projectName = YOUR_PROJECT_NAME;
  console.log("projectName", projectName);
  const s3BucketName = YOUR_S3_BUCKET_NAME;
  const folderName = projectName;

  let projectID = await createVercelProject(token, projectName);
  console.log(projectID);
  const vercelProject = await setNodeVersion(projectID, token);
  console.log("vercelProject:", vercelProject);
  if (!projectID) {
    try {
      const projects = await getVercelProjects(token);
      const project = projects.projects.find((proj) => proj.name === projectName);
      if (project) {
        const projectID = project.id;
        console.log('Vercel Project ID:', projectID);
      } else {
        throw new Error(`Project '${projectName}' not found.`);
      }
    } catch (error) {
      console.error('Error:', error.message);
      return {
        statusCode: 500,
        body: `Error: ${error.message}`,
      };
    }
  }
  const objectKeys = await getObjectKeys(s3BucketName, folderName);
  const filteredObjectKeys = objectKeys.filter(objectKey => !objectKey.includes('.git') && !objectKey.includes('README.md'));
  const signedUrls = await Promise.all(
    filteredObjectKeys.map((key) => getSignedUrlData(s3BucketName, key))
  );
  console.log("urls", signedUrls);
  await downloadFiles(signedUrls);
  // Step 2: Trigger a deployment in Vercel for the signed URLs
  const deployment = await triggerVercelDeployment(token, projectID, signedUrls, folderName);
  await deleteFolder(folderName)
  return {
    statusCode: 200,
    body: `Deployment got successful, the website url is ${deployment?.url}`,
  };
};

const deleteFolder = async (folderName) => {
  const temporaryDirectory = os.tmpdir();
  console.log("temporaryDirectory", temporaryDirectory);
  if (!fs.existsSync(temporaryDirectory+folderName)) {
    return;
  }

  await fs.rmdir(temporaryDirectory+folderName);
};
/**
 * getObjectKeys - get the nextjs application files as S3 objects
 * @param {*} bucketName s3 bucket name which contains the list of Next Js application
 * @param {*} folderName s3 folder contains the Next Js we want to deploy into Vercel
 * @returns 
 */
async function getObjectKeys(bucketName, folderName) {
  const listObjectsCommand = new ListObjectsCommand({
    Bucket: bucketName,
    Prefix: `${folderName}/`,
  });

  const response = await s3Client.send(listObjectsCommand);
  const objects = response.Contents;
  const objectKeys = objects.map((object) => object.Key);

  return objectKeys;
}

/**
 * getSignedUrlData - get the presigned URL for all the s3 object keys(i.e for all the project files)
 * @param {*} bucketName s3 bucket name which contains the list of Next Js application
 * @param {*} objectKey s3 object key for the Next Js application files
 * @returns 
 */
async function getSignedUrlData(bucketName, objectKey) {
  const params = {
    Bucket: bucketName,
    Key: objectKey,
  };

  const command = new GetObjectCommand(params);
  const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 360000 });
  // return signedUrl;
  const parsedUrl = parse(signedUrl);
  parsedUrl.protocol = "http:";

  // Convert the modified URL object back to a string
  const httpPresignedUrl = parsedUrl.format();

  return httpPresignedUrl;
}

/**
 * triggerVercelDeployment - triggers the Vercel Deployment inside the project created for the Next Js application.
 * @param {*} authToken authentication token for the vercel account
 * @param {*} projectID vercel project id
 * @param {*} signedUrls aws s3 nextjs project file presigned URL's
 * @param {*} folderName aws s3 nextjs project folder inside the AWS S3 bucket
 * @returns vercel deployment data
 */
async function triggerVercelDeployment(authToken, projectID, signedUrls, folderName) {
  let deployment = undefined;
  const temporaryDirectory = os.tmpdir();
  console.log("temporaryDirectory", temporaryDirectory);
  console.log('createDeployment ', createDeployment);
  for await (const event of createDeployment({
    token: authToken,
    teamId: "team_Y6iorVTQiUAff3HsrpWHZ6am",
    path: path.resolve(`/tmp/${folderName}`),
    // path: path.resolve(`./${folderName}`),
    project: {
      id: projectID
    },
    projectSettings: {
      buildCommand: null,
      devCommand: null,
      framework: 'nextjs',
      commandForIgnoringBuildStep: '',
      installCommand: null,
      outputDirectory: null,
    },
    files: signedUrls,
  })) {
    console.log('event.type', event.type);
    if (event.type === 'ready') {
      console.log('Breaking ', event);
      deployment = event.payload;
      break;
    }
    if (event.type === 'error') {
      console.log('Breaking ', event);
      break;
    }
  }
  fs.rm(`${temporaryDirectory}/${folderName}`, { recursive: true, force: true }, (error) => {
    if (error) {
      console.error(error);
    } else {
      console.log(`Directory '${folderName}' is deleted.`);
    }
  });
  return deployment;
}

/**
 * getVercelProjects - get the list of vercel projects under the account.
 * @param {*} token authentication token for the vercel account
 * @returns list of vercel projects
 */
async function getVercelProjects(token) {
  const options = {
    hostname: 'api.vercel.com',
    path: '/v8/projects/?teamId=team_Y6iorVTQiUAff3HsrpWHZ6am',
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          const projects = JSON.parse(data);
          resolve(projects);
        } else {
          reject(new Error(`Failed to fetch Vercel projects: ${res.statusCode} ${res.statusMessage}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * downloadFile - download the file
 * @param {*} url aWS s3 objects presigned URL
 * @param {*} destination local path location
 */
async function downloadFile(url, destination) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(destination, Buffer.from(response.data, 'binary'));
}

/**
 * downloadFiles - download the files
 * @param {*} urls aws s3 objects presigned URL
 */
async function downloadFiles(urls) {
  for (const url of urls) {
    console.log(url);
    let fileName = path.basename(url.split('?')[0]);
    const temporaryDirectory = os.tmpdir();
    console.log("temporaryDirectory", temporaryDirectory);
    let dirName = `${temporaryDirectory}/${url.split('?')[0].split("amazonaws.com/")[url.split('?')[0].split("amazonaws.com/").length-1]}`;
    dirName = dirName.replace(`/${fileName}`, '');
    path.resolve(dirName);
    try {
      fs.mkdirSync(dirName, { recursive: true });
    } catch(error) {
      console.log(error)
    }
    // if (!fs.existsSync(dirName)) {
    //   fs.mkdirSync(dirName, { recursive: true });
    // }
    console.log(fileName);
    const filePath = path.join(dirName, fileName);
    await downloadFile(url, filePath);
    console.log(`Downloaded: ${filePath}`);
  }
}

/**
 * createVercelProject - creates the vercel nextjs framework project
 * @param {*} token authentication token for the vercel account
 * @param {*} projectName vercel project name
 * @returns 
 */
async function createVercelProject(token, projectName) {
  const options = {
    hostname: 'api.vercel.com',
    path: '/v1/projects/?teamId=team_Y6iorVTQiUAff3HsrpWHZ6am',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log(res.statusCode)
        console.log(data)
        if (res.statusCode === 200) {
          const { id } = JSON.parse(data);
          resolve(id);
        } else {
          resolve(undefined);
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(JSON.stringify({ 
      name: projectName, 
      framework: "nextjs"
    }));

    req.end();
  });
}

// Function to set the Node.js version using Vercel API's set-build-env endpoint
function setNodeVersion(projectId, token) {
  const options = {
    hostname: 'api.vercel.com',
    path: `/v1/projects/${projectId}/?teamId=YOUR_VERCEL_TEAM_ID`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  const envData = {
    key: 'NODE_VERSION',
    value: '16',
    teamId: YOUR_VERCEL_TEAM_ID,
    scope: 'team',
  };

  const req = https.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      console.log(data)
      console.log('Node.js version set successfully:', JSON.parse(data));
    });
  });

  req.on('error', (err) => {
    console.log(err)
    console.error('Error setting Node.js version:', err.message);
  });

  req.write(JSON.stringify(envData)); // Send the environment variable data in the request body
  req.end();
}