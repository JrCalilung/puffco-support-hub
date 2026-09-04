import os, json, boto3, urllib.request, urllib.parse

def detect_content_type(data):
    if data[:4] == b'\x89PNG':
        return 'image/png', 'return_label.png'
    if data[:4] == b'%PDF':
        return 'application/pdf', 'return_label.pdf'
    if data[:2] in (b'\xff\xd8', b'\xff\xe0'):
        return 'image/jpeg', 'return_label.jpg'
    return 'application/octet-stream', 'return_label.bin'

from datetime import datetime, timezone

s3       = boto3.client("s3",             region_name="us-west-2")
dynamodb = boto3.resource("dynamodb",     region_name="us-west-2")
secrets  = boto3.client("secretsmanager", region_name="us-west-2")

MAX_DOWNLOADS = 5

def get_secret(name):
    return json.loads(secrets.get_secret_value(SecretId=name)["SecretString"])

def get_access_token():
    creds = get_secret(os.environ["STAMPS_SECRET_NAME"])
    now   = datetime.now(timezone.utc).timestamp()
    # Check if cached token is still valid
    expires_at = float(creds.get("token_expires_at_ts", 0))
    if creds.get("access_token") and now < expires_at - 60:
        return creds["access_token"]
    # Refresh token
    data = urllib.parse.urlencode({
        "grant_type":    "refresh_token",
        "client_id":     creds["client_id"],
        "client_secret": creds["client_secret"].strip(),
        "refresh_token": creds["refresh_token"],
    }).encode()
    req = urllib.request.Request(
        os.environ["STAMPS_AUTH_URL"], data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST"
    )
    token_data   = json.loads(urllib.request.urlopen(req, timeout=10).read())
    access_token = token_data["access_token"]
    expires_in   = token_data.get("expires_in", 900)
    # Save updated tokens
    creds["access_token"]       = access_token
    creds["token_expires_at_ts"] = str(now + expires_in)
    if token_data.get("refresh_token"):
        creds["refresh_token"] = token_data["refresh_token"]
    secrets.put_secret_value(
        SecretId=os.environ["STAMPS_SECRET_NAME"],
        SecretString=json.dumps(creds)
    )
    return access_token

def get_label_from_sera(stamps_label_id):
    """Retrieve label PDF from Stamps.com SERA API as fallback."""
    token   = get_access_token()
    api_url = f"{os.environ['STAMPS_API_BASE']}/labels/{stamps_label_id}"
    req = urllib.request.Request(
        api_url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET"
    )
    resp      = json.loads(urllib.request.urlopen(req, timeout=15).read())
    label_url = resp.get("labels", [{}])[0].get("href", "")
    if not label_url:
        raise Exception("No label URL returned from SERA API")
    # Download the PDF from Stamps.com
    pdf_req  = urllib.request.Request(
        label_url,
        headers={"Authorization": f"Bearer {token}"},
        method="GET"
    )
    pdf_bytes = urllib.request.urlopen(pdf_req, timeout=15).read()
    return pdf_bytes

def lambda_handler(event, context):
    print("EVENT:", str(event))
    try:
        label_id = event["pathParameters"]["label_id"]
        table    = dynamodb.Table(os.environ["RETURN_LABELS_TABLE"])
        record   = table.get_item(Key={"label_id": label_id}).get("Item")

        if not record:
            return {
                "statusCode": 404,
                "headers": {"Content-Type": "application/json"},
                "body": "Label not found"
            }

        # Check 30-day expiry
        expires_at = record.get("expires_at")
        if expires_at and datetime.now(timezone.utc).isoformat() > expires_at:
            return {
                "statusCode": 410,
                "headers": {"Content-Type": "application/json"},
                "body": "This return label link has expired. Please contact Puffco Support for a new label."
            }

        # Check download count cap
        download_count = int(record.get("download_count", 0))
        if download_count >= MAX_DOWNLOADS:
            return {
                "statusCode": 429,
                "headers": {"Content-Type": "application/json"},
                "body": "This label has reached the maximum number of downloads. Please contact Puffco Support for a new label."
            }

        # Increment download count
        table.update_item(
            Key={"label_id": label_id},
            UpdateExpression="SET download_count = download_count + :inc",
            ExpressionAttributeValues={":inc": 1},
        )

        # Try S3 cache first
        try:
            url = s3.generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": os.environ["RETURN_LABELS_BUCKET"],
                    "Key":    record["s3_key"],
                    "ResponseContentDisposition": "attachment; filename=return_label.png",
                    "ResponseContentType":        "image/png",
                },
                ExpiresIn=900
            )
            # Verify object exists
            s3.head_object(Bucket=os.environ["RETURN_LABELS_BUCKET"], Key=record["s3_key"])
            print(f"Label {label_id} served from S3 cache — count now {download_count + 1}/{MAX_DOWNLOADS}")
            return {
                "statusCode": 302,
                "headers": {"Location": url},
                "body": ""
            }
        except Exception as s3_err:
            print(f"S3 cache miss for {label_id}: {s3_err} — falling back to SERA API")

        # Fallback: retrieve from Stamps.com SERA API
        stamps_label_id = record.get("stamps_label_id")
        if not stamps_label_id:
            raise Exception("Label not found in S3 and no Stamps.com label ID available for retrieval.")

        print(f"Retrieving label {stamps_label_id} from Stamps.com SERA API")
        pdf_bytes = get_label_from_sera(stamps_label_id)
        content_type, filename = detect_content_type(pdf_bytes)

        # Re-cache in S3 for future downloads
        try:
            s3.put_object(
                Bucket=os.environ["RETURN_LABELS_BUCKET"],
                Key=record["s3_key"],
                Body=pdf_bytes,
                ContentType=content_type
            )
            print(f"Label re-cached in S3: {record['s3_key']} as {content_type}")
        except Exception as cache_err:
            print(f"Re-cache failed (non-fatal): {cache_err}")

        # Return file directly
        import base64
        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": content_type,
                "Content-Disposition": f"attachment; filename={filename}",
            },
            "body": base64.b64encode(pdf_bytes).decode(),
            "isBase64Encoded": True
        }

    except Exception as e:
        print(f"ERROR: {e}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": str(e)
        }
