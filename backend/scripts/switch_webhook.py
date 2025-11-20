"""
CompanyCam Webhook URL Switcher
Easily switch webhook between local (ngrok) and production
"""

import asyncio
import httpx
import sys
from app.core.config import settings


WEBHOOK_ID = 147656
PRODUCTION_URL = "https://mjestimate-backend.onrender.com/api/integrations/companycam/webhook"


async def get_ngrok_url():
    """Get current ngrok URL from local API"""
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get("http://localhost:4040/api/tunnels")
            data = response.json()
            if data.get("tunnels"):
                return data["tunnels"][0]["public_url"]
    except Exception:
        pass
    return None


async def update_webhook(url: str):
    """Update CompanyCam webhook URL"""
    api_key = settings.COMPANYCAM_API_KEY
    webhook_token = settings.COMPANYCAM_WEBHOOK_TOKEN

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "url": url,
        "events": ["project.created", "photo.created", "project.updated", "photo.deleted"],
        "secret": webhook_token,
        "enabled": True
    }

    async with httpx.AsyncClient() as client:
        response = await client.patch(
            f"https://api.companycam.com/v2/webhooks/{WEBHOOK_ID}",
            headers=headers,
            json=payload
        )

        if response.status_code in [200, 204]:
            result = response.json()
            return result
        else:
            raise Exception(f"Failed to update webhook: {response.text}")


async def main():
    """Main entry point"""

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python switch_webhook.py local     # Switch to ngrok (local)")
        print("  python switch_webhook.py prod      # Switch to production")
        print("  python switch_webhook.py status    # Show current webhook")
        sys.exit(1)

    mode = sys.argv[1].lower()

    # Get current webhook status
    api_key = settings.COMPANYCAM_API_KEY
    headers = {"Authorization": f"Bearer {api_key}"}

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"https://api.companycam.com/v2/webhooks/{WEBHOOK_ID}",
            headers=headers
        )
        current = response.json()

    if mode == "status":
        print("=== Current Webhook Configuration ===")
        print(f"URL: {current.get('url')}")
        print(f"Enabled: {current.get('enabled')}")
        print(f"Events: {current.get('scopes')}")
        return

    if mode == "local":
        print("=== Switching to LOCAL (ngrok) ===\n")

        ngrok_url = await get_ngrok_url()
        if not ngrok_url:
            print("ERROR: ngrok not running!")
            print("Start ngrok first: ngrok http 8000")
            sys.exit(1)

        webhook_url = f"{ngrok_url}/api/integrations/companycam/webhook"
        print(f"ngrok URL: {webhook_url}")

    elif mode in ["prod", "production"]:
        print("=== Switching to PRODUCTION ===\n")
        webhook_url = PRODUCTION_URL
        print(f"Production URL: {webhook_url}")

    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1)

    # Update webhook
    result = await update_webhook(webhook_url)

    print("\n✅ SUCCESS!")
    print(f"Webhook URL: {result.get('url')}")
    print(f"Enabled: {result.get('enabled')}")
    print(f"Events: {result.get('scopes')}")


if __name__ == "__main__":
    asyncio.run(main())
