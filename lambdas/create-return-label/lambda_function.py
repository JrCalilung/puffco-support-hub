import json, os, uuid, boto3, base64, urllib.request, urllib.parse
from datetime import date, datetime, timezone, timedelta
import requests

secrets  = boto3.client("secretsmanager", region_name="us-west-2")
dynamodb = boto3.resource("dynamodb",      region_name="us-west-2")
s3       = boto3.client("s3",             region_name="us-west-2")

_token_cache = {"access_token": None, "expires_at": None}

SERA_ERROR_MESSAGES = {
    "4522241": "Return label service (POUR) is not enabled on this account — please contact IT.",
    "4522242": "Incomplete address — please verify the street address, city, state, and ZIP code are all filled in correctly.",
    "4522200": "Invalid ZIP code — please check the ZIP code entered for the customer.",
    "4522201": "Invalid state — please use a valid 2-letter state code (e.g. CA, NY, TX).",
    "4522203": "Invalid city — please verify the city name matches the ZIP code.",
    "4522210": "Address not found — USPS could not verify this address. Please confirm with the customer.",
    "4522220": "Invalid recipient name — please check the customer name field.",
    "4522300": "Invalid package weight — please verify the weight entered is correct.",
    "4522400": "Service not available for this address — USPS Priority Mail may not be available to this location.",
    "4000000": "Stamps.com account error — please contact IT to verify the account configuration.",
}

def get_friendly_error(response_text, status_code):
    try:
        import json as _json
        error_data = _json.loads(response_text)
        error_code = str(error_data.get("error_code") or error_data.get("errorCode") or error_data.get("code") or "")
        error_msg  = error_data.get("message") or error_data.get("error") or ""
        if error_code in SERA_ERROR_MESSAGES:
            return SERA_ERROR_MESSAGES[error_code]
        for code, msg in SERA_ERROR_MESSAGES.items():
            if code in error_code or code in str(error_msg):
                return msg
        if status_code == 401:
            return "Authentication error — the Stamps.com session has expired. Please contact IT to re-authorize the integration."
        if status_code == 429:
            return "Too many requests — please wait a moment and try again."
        if status_code == 503:
            return "Stamps.com service is temporarily unavailable. Please try again in a few minutes."
        if error_msg:
            return f"Stamps.com error: {error_msg}"
        return f"Stamps.com returned an unexpected error (code {status_code}). Please try again or contact IT."
    except Exception:
        if status_code == 401:
            return "Authentication error — please contact IT to re-authorize the Stamps.com integration."
        return f"Stamps.com returned an error (HTTP {status_code}). Please try again or contact IT."

def get_secret(name):
    return json.loads(secrets.get_secret_value(SecretId=name)["SecretString"])

def refresh_access_token():
    """Force a token refresh regardless of cache state."""
    global _token_cache
    now   = datetime.now(timezone.utc).timestamp()
    creds = get_secret(os.environ["STAMPS_SECRET_NAME"])
    data  = urllib.parse.urlencode({
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
    try:
        response   = urllib.request.urlopen(req, timeout=10)
        token_data = json.loads(response.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()
        print(f"OAuth refresh failed {e.code}: {error_body}")
        raise Exception(
            "Return label service authorization has expired and requires manual re-authorization. "
            "Please contact IT to re-run the Stamps.com OAuth flow."
        )

    access_token = token_data["access_token"]
    expires_in   = token_data.get("expires_in", 900)
    new_refresh  = token_data.get("refresh_token")

    _token_cache["access_token"] = access_token
    _token_cache["expires_at"]   = now + expires_in

    creds["access_token"] = access_token
    if new_refresh:
        creds["refresh_token"] = new_refresh
        print("Refresh token rotated — updated in Secrets Manager")
    creds["token_expires_at"] = datetime.fromtimestamp(now + expires_in, tz=timezone.utc).isoformat()
    creds["token_expires_in"] = str(expires_in)

    secrets.put_secret_value(
        SecretId=os.environ["STAMPS_SECRET_NAME"],
        SecretString=json.dumps(creds)
    )
    print(f"Token refreshed — expires in {expires_in}s")
    return access_token

def get_access_token():
    now = datetime.now(timezone.utc).timestamp()
    # Use cache if valid with 60s buffer
    if _token_cache["access_token"] and _token_cache["expires_at"] \
            and now < _token_cache["expires_at"] - 60:
        return _token_cache["access_token"]
    # Cache miss or expired — refresh
    return refresh_access_token()

def stamps_headers():
    return {
        "Authorization": f"Bearer {get_access_token()}",
        "Content-Type":  "application/json",
    }

def create_label(label_id, from_addr, weight_oz, ticket_id, attn_line="ATTN: Puffco Warranty", attn_label="Puffco Warranty"):
    payload = {
        "is_return_label": True,
        "service_type":    "usps_priority_mail",
        "ship_date":       date.today().strftime("%Y-%m-%dT00:00:00.000Z"),
        "from_address": {
            "name":           from_addr["name"],
            "phone":          from_addr.get("phone", "3105550000"),
            "address_line1":  from_addr["address1"],
            "city":           from_addr["city"],
            "state_province": from_addr["state"],
            "postal_code":    from_addr["zip"],
            "country_code":   "US",
        },
        "to_address": {
            "name":           attn_line,
            "phone":          os.environ.get("RETURN_TO_PHONE", "3105550000"),
            "address_line1":  os.environ["RETURN_TO_ADDRESS1"],
            "city":           os.environ["RETURN_TO_CITY"],
            "state_province": os.environ["RETURN_TO_STATE"],
            "postal_code":    os.environ["RETURN_TO_ZIP"],
            "country_code":   "US",
        },
        "packages": [{"weight": {"value": weight_oz, "unit": "ounce"}}],
        "advanced_options": {"is_pay_on_use": True},
        "label_options": {
            "memo":             "Puffco Support",
            "reference_number": f"ZD-{ticket_id}"
        },
        "references": {
            "printed_message1": f"Zendesk: ZD-{ticket_id}",
            "printed_message2": attn_label
        }
    }
    if from_addr.get("address2", "").strip():
        payload["from_address"]["address_line2"] = from_addr["address2"]
    if os.environ.get("RETURN_TO_ADDRESS2", "").strip():
        payload["to_address"]["address_line2"] = os.environ["RETURN_TO_ADDRESS2"]

    hdrs = stamps_headers()
    hdrs["Idempotency-key"] = label_id
    print(f"Stamps.com payload: {json.dumps(payload)}")

    resp = requests.post(
        f"{os.environ['STAMPS_API_BASE']}/labels",
        headers=hdrs, json=payload, timeout=25
    )

    # ── Auto-retry on 401 or 404 (Stamps.com returns 404 for expired tokens) ──
    print(f'SERA response status: {resp.status_code}, body: {resp.text[:200]}')
    if resp.status_code in (401, 404):
        print(f"Got {resp.status_code} from SERA — forcing token refresh and retrying once")
        _token_cache["access_token"] = None
        _token_cache["expires_at"]   = None
        new_token = refresh_access_token()
        hdrs["Authorization"] = f"Bearer {new_token}"
        resp = requests.post(
            f"{os.environ['STAMPS_API_BASE']}/labels",
            headers=hdrs, json=payload, timeout=25
        )

    if not resp.ok:
        print(f"Stamps.com error {resp.status_code}: {resp.text}")
        friendly = get_friendly_error(resp.text, resp.status_code)
        raise Exception(friendly)

    return resp.json()

def get_zd_credentials():
    return (
        get_secret(os.environ["ZENDESK_TOKEN_SECRET_NAME"])["zendesk_api_token"],
        get_secret(os.environ["ZENDESK_EMAIL_SECRET_NAME"])["zendesk_email"],
        get_secret(os.environ["ZENDESK_SUBDOMAIN_SECRET_NAME"])["zendesk_subdomain"],
    )

def zd_request(zd_subdomain, ticket_id, payload, zd_email, zd_token):
    token_b64 = base64.b64encode(f"{zd_email}/token:{zd_token}".encode()).decode()
    req = urllib.request.Request(
        f"https://{zd_subdomain}.zendesk.com/api/v2/tickets/{ticket_id}.json",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Basic {token_b64}", "Content-Type": "application/json"},
        method="PUT",
    )
    urllib.request.urlopen(req)

def post_internal_note(ticket_id, tracking, stamps_label_id, agent_url, product_type, amount, expires_at, zd_token, zd_email, zd_subdomain):
    body = (
        f"Return label generated via Stamps.com API.\n"
        f"Product: {product_type}\n"
        f"Tracking: {tracking}\n"
        f"Stamps.com Label ID: {stamps_label_id}\n"
        f"Agent PDF download: {agent_url}\n"
        f"Customer link expires: {expires_at[:10]}\n"
        f"Download limit: 5 attempts"
    )
    zd_request(zd_subdomain, ticket_id,
               {"ticket": {"comment": {"body": body, "public": False}}},
               zd_email, zd_token)

def lambda_handler(event, context):
    print("EVENT:", json.dumps(event))
    try:
        body_raw       = json.loads(event.get("body") or "{}")
        ticket_id      = str(body_raw["ticket_id"])
        customer_name  = body_raw["customer_name"]
        customer_email = body_raw["customer_email"]
        address        = body_raw["address"]
        weight_oz      = int(body_raw.get("weight_oz", 32))
        product_type   = body_raw.get("product_type", "Unknown")
        inquiry_type   = body_raw.get("inquiry_type", "")

        # ATTN line mapping
        attn_map = {
            "product_issue": ("ATTN: Puffco Warranty", "Puffco Warranty"),
            "returns":       ("ATTN: Puffco Returns",  "Puffco Returns"),
        }
        attn_line, attn_label = attn_map.get(inquiry_type, ("ATTN: Puffco Warranty", "Puffco Warranty"))

        label_id = str(uuid.uuid4())
        from_addr = {
            "name":     customer_name,
            "address1": address["address1"],
            "address2": address.get("address2", ""),
            "city":     address["city"],
            "state":    address["state"],
            "zip":      address["zip"],
        }

        label_data    = create_label(label_id, from_addr, weight_oz, ticket_id, attn_line, attn_label)
        tracking      = label_data["tracking_number"]
        stamps_label_id = label_data.get("label_id") or label_data.get("id") or label_id
        postage_amount  = label_data.get("postage_amount") or label_data.get("amount") or 0
        label_pdf_url   = label_data.get("label_download", {}).get("pdf") or label_data.get("label_url") or ""

        # Store label PDF in S3
        expires_at = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        s3_key     = f"labels/{ticket_id}/{label_id}.pdf"

        if label_pdf_url:
            pdf_resp = requests.get(label_pdf_url, timeout=15)
            if pdf_resp.ok:
                s3.put_object(
                    Bucket=os.environ["RETURN_LABELS_BUCKET"],
                    Key=s3_key,
                    Body=pdf_resp.content,
                    ContentType="application/pdf"
                )

        # Store record in DynamoDB
        table = dynamodb.Table(os.environ["RETURN_LABELS_TABLE"])
        table.put_item(Item={
            "label_id":        label_id,
            "ticket_id":       ticket_id,
            "tracking_number": tracking,
            "stamps_label_id": str(stamps_label_id),
            "postage_amount":  str(postage_amount),
            "product_type":    product_type,
            "customer_name":   customer_name,
            "customer_email":  customer_email,
            "s3_key":          s3_key,
            "expires_at":      expires_at,
            "download_count":  0,
            "created_at":      datetime.now(timezone.utc).isoformat(),
        })

        base_url      = os.environ["AGENT_DOWNLOAD_BASE_URL"]
        agent_url     = f"{base_url}/return-label/download/{label_id}"
        customer_url  = f"{base_url}/return-label/download/{label_id}"

        # Post internal note to Zendesk
        zd_token, zd_email, zd_subdomain = get_zd_credentials()
        post_internal_note(
            ticket_id, tracking, stamps_label_id,
            agent_url, product_type, postage_amount,
            expires_at, zd_token, zd_email, zd_subdomain
        )

        customer_message = (
            f"We've created a prepaid USPS return shipping label for your {product_type} return.\n\n"
            f"Click the link below to download your label:\n{customer_url}\n\n"
            f"Print the label, attach it to your package, and drop it off at any USPS location — no postage needed.\n\n"
            f"Tracking number: {tracking}\n\n"
            f"This link will expire in 30 days. If you need a new label please reply to this ticket.\n\n"
            f"Thank you,\nPuffco Support"
        )

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "success":          True,
                "tracking_number":  tracking,
                "stamps_label_id":  str(stamps_label_id),
                "postage_amount":   str(postage_amount),
                "agent_url":        agent_url,
                "customer_label_url": customer_url,
                "customer_message": customer_message,
                "expires_at":       expires_at,
            })
        }

    except Exception as e:
        print(f"ERROR: {e}")
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": str(e)})
        }
