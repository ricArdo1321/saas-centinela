---
description: Deploy to VPS (72.61.3.235)
---

# Deploy Centinela to VPS

## VPS Connection Details

- **IP**: 72.61.3.235
- **User**: root
- **Project Path**: /root/saas-centinela (verify on first run)

## Steps

// turbo-all

1. Connect to VPS and pull latest code:

```bash
ssh root@72.61.3.235 "cd /root/saas-centinela && git pull origin main"
```

1. Rebuild and restart AI agents:

```bash
ssh root@72.61.3.235 "cd /root/saas-centinela && ./ops/update_vps.sh"
```

1. Run database migrations (if needed):

```bash
ssh root@72.61.3.235 "cd /root/saas-centinela/backend && npm run db:migrate"
```

1. Check agent status:

```bash
ssh root@72.61.3.235 "docker compose -f /root/saas-centinela/agents/docker-compose.yml ps"
```

1. View agent logs:

```bash
ssh root@72.61.3.235 "docker compose -f /root/saas-centinela/agents/docker-compose.yml logs --tail=50"
```
