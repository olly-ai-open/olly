#!/bin/bash

# Sync environment variables from AWS SSM Parameter Store to local .env files
# Usage: ./scripts/sync-env.sh [stage]
# Default stage is 'prod'

set -e

STAGE=${1:-prod}
REGION=${AWS_REGION:-us-west-2}

echo "  Syncing environment variables from AWS SSM..."
echo "   Stage: $STAGE"
echo "   Region: $REGION"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "AWS credentials are not configured. Please run 'aws configure' first."
    exit 1
fi

# Define all parameters to fetch
PARAMETERS=(
    "/olly/$STAGE/PRISMA_DATABASE_URL"
    "/olly/$STAGE/PRISMA_FIELD_ENCRYPTION_KEY"
    "/olly/$STAGE/GOOGLE_CLIENT_ID"
    "/olly/$STAGE/GOOGLE_CLIENT_SECRET"
    "/olly/$STAGE/NEXTAUTH_URL"
    "/olly/$STAGE/NEXTAUTH_SECRET"
    "/olly/$STAGE/OPENAI_API_KEY"
    "/olly/$STAGE/OPENAI_MODEL"
    "/olly/$STAGE/OPENAI_TEMPERATURE"
    "/olly/$STAGE/S3_DEBUG_BUCKET"
    "/olly/$STAGE/ENABLE_DEBUG_CAPTURE"
    "/olly/$STAGE/SUPABASE_URL"
    "/olly/$STAGE/SUPABASE_ANON_KEY"
    "/olly/$STAGE/SUPABASE_SERVICE_KEY"
    "/olly/$STAGE/SLACK_CLIENT_ID"
    "/olly/$STAGE/SLACK_CLIENT_SECRET"
    "/olly/$STAGE/NEXT_PUBLIC_VAPID_PUBLIC_KEY"
    "/olly/$STAGE/VAPID_PUBLIC_KEY"
    "/olly/$STAGE/VAPID_PRIVATE_KEY"
    "/olly/$STAGE/LANGFUSE_SECRET_KEY"
    "/olly/$STAGE/LANGFUSE_PUBLIC_KEY"
    "/olly/$STAGE/LANGFUSE_BASE_URL"
    "/olly/$STAGE/NOTION_CLIENT_ID"
    "/olly/$STAGE/NOTION_CLIENT_SECRET"
)

# Create temporary file for parameters
TEMP_FILE=$(mktemp)

echo "Fetching parameters from SSM..."

# Fetch parameters in batches (SSM has a limit of 10 parameters per request)
BATCH_SIZE=10
for ((i=0; i<${#PARAMETERS[@]}; i+=BATCH_SIZE)); do
    BATCH=("${PARAMETERS[@]:i:BATCH_SIZE}")
    
    # Join array elements with spaces
    PARAMS_STRING="${BATCH[*]}"
    
    # Fetch parameters from SSM
    aws ssm get-parameters \
        --names $PARAMS_STRING \
        --with-decryption \
        --region "$REGION" \
        --query "Parameters[*].[Name,Value]" \
        --output text 2>/dev/null >> "$TEMP_FILE" || true
done

# Create .env.local for Next.js app
ENV_FILE="apps/web/.env.local"
echo "Writing to $ENV_FILE..."
echo "# Auto-generated from AWS SSM - DO NOT EDIT DIRECTLY" > "$ENV_FILE"
echo "# Generated at: $(date)" >> "$ENV_FILE"
echo "# Stage: $STAGE" >> "$ENV_FILE"
echo "# Run 'npm run sync-env' to update" >> "$ENV_FILE"
echo "" >> "$ENV_FILE"

# Process parameters and write to .env.local
FOUND_COUNT=0
while IFS=$'\t' read -r name value; do
    if [[ ! -z "$name" ]]; then
        # Extract the key name from the parameter path
        key=${name##*/}
        echo "$key=$value" >> "$ENV_FILE"
        ((FOUND_COUNT++))
    fi
done < "$TEMP_FILE"

# Also create .env.local in the root for packages
ROOT_ENV_FILE=".env.local"
cp "$ENV_FILE" "$ROOT_ENV_FILE"

# Create .env.local for worker (if it exists)
if [[ -d "apps/worker" ]]; then
    WORKER_ENV_FILE="apps/worker/.env.local"
    cp "$ENV_FILE" "$WORKER_ENV_FILE"
    echo "Written to $WORKER_ENV_FILE"
fi

# Clean up
rm "$TEMP_FILE"

if [[ $FOUND_COUNT -eq 0 ]]; then
    echo "   No parameters found. Make sure parameters exist in SSM at path: /olly/$STAGE/"
    echo "   You can create them using:"
    echo "   aws ssm put-parameter --name '/olly/$STAGE/PARAM_NAME' --value 'value' --type 'SecureString'"
else
    echo " Successfully synced $FOUND_COUNT environment variables"
    echo " Files created:"
    echo "   - $ENV_FILE"
    echo "   - $ROOT_ENV_FILE"
    [[ -d "apps/worker" ]] && echo "   - $WORKER_ENV_FILE"
fi
