FROM node:18

# Create app directory
WORKDIR /usr/src/app

#!/bin/bash
export AWS_ACCESS_KEY_ID=
export AWS_SECRET_ACCESS_KEY=
export VERCEL_YES=true
export VERCEL_TOKEN=

npm install -g vercel --save-if-not-present

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
  echo "Vercel CLI is not installed. Please install it first."
  exit 1
fi

# Get the S3 bucket name
s3_bucket_name=

# Get the S3 bucket region
s3_bucket_region="us-east-1"

# Get the Next.js app directory
next_app_dir="nextjs-blog-1"

echo s3://$s3_bucket_name/$next_app_dir/

# Download the Next.js app from S3
aws s3 cp s3://aws-s3-as-code-repo-for-vercel ./ --recursive

# Build the Next.js app
cd $next_app_dir
npm i
npm run build

vercel --token=$VERCEL_TOKEN --yes --force

# vercel --token=$VERCEL_TOKEN whoami

cd nextjs-blog-1

# Deploy the Next.js app to Vercel
vercel --token=$VERCEL_TOKEN deploy --yes --force