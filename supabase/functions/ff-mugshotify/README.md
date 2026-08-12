# ff-mugshotify

Supabase Edge Function used by `join/index.html` to convert uploaded mugshots
into cartoon lineup avatars with OpenAI image edits.

## Deploy

```powershell
supabase secrets set OPENAI_API_KEY=your_openai_api_key FF_MUGSHOT_CLIENT_KEY=sb_publishable_6a9XqxYa0-AZtyrwz4ZeUg_aiMsVH-3 --project-ref qmaafbncpzrdmqapkkgr
supabase functions deploy ff-mugshotify --no-verify-jwt --project-ref qmaafbncpzrdmqapkkgr
```

Optional knobs:

```powershell
supabase secrets set OPENAI_IMAGE_MODEL=gpt-image-1.5 OPENAI_IMAGE_QUALITY=medium --project-ref qmaafbncpzrdmqapkkgr
```

The join page calls:

```text
https://qmaafbncpzrdmqapkkgr.supabase.co/functions/v1/ff-mugshotify
```
