#!/bin/bash

echo "Step 1: Rotating company name..."
python3 -c "
import json, time
with open('/Users/jaspersabin/Vallenwood---Diagnostic/test-payload.json') as f:
    p = json.load(f)
p['company_name'] = f'Acme SaaS {int(time.time()) % 10000}'
with open('/Users/jaspersabin/Vallenwood---Diagnostic/test-payload.json', 'w') as f:
    json.dump(p, f, indent=2)
print('company_name:', p['company_name'])
"

echo ""
rm -f /tmp/vw-diag.json /tmp/vw-enrich.json /tmp/vw-ids.env

echo "Step 2: Firing diagnostic..."
curl -s -X POST https://vallenwood-diagnostic.vercel.app/api/diagnostic \
  -H "Content-Type: application/json" \
  -H "x-vw-token: vw_prod_9c84f2b1e7a64c3d" \
  -d @/Users/jaspersabin/Vallenwood---Diagnostic/test-payload.json \
  -o /tmp/vw-diag.json

echo "Diagnostic done. Building enrich payload..."

python3 -c "
import json

with open('/tmp/vw-diag.json') as f:
    d = json.load(f)

def get_id(url):
    if not url or 'id=' not in url:
        return ''
    return url.split('id=')[1].split('&')[0]

tier        = d.get('tier', 'audit')
hidden_id   = get_id(d.get('hidden_report_url'))
audit_id    = get_id(d.get('audit_report_url'))
exec_id     = get_id(d.get('exec_report_url'))
r           = d.get('report', {})

print(f'Tier={tier}  Hidden={hidden_id}  Audit={audit_id}  Exec={exec_id}')

payload = {
    'tier': tier,
    'hiddenReportId': hidden_id,
    'auditReportId': audit_id if audit_id else None,
    'report': {
        'client': r.get('client'),
        'inputs': {'normalized_answers': r.get('inputs', {}).get('normalized_answers')},
        'scoring': r.get('scoring'),
        'narrative': r.get('narrative'),
        'full_tier': r.get('full_tier'),
        'generated_at': r.get('generated_at'),
    }
}

with open('/tmp/vw-enrich.json', 'w') as f:
    json.dump(payload, f)

with open('/tmp/vw-ids.env', 'w') as f:
    f.write(f'HIDDEN_ID={hidden_id}\nAUDIT_ID={audit_id}\nEXEC_ID={exec_id}\nTIER={tier}\n')

print('Payload written:', len(open(\"/tmp/vw-enrich.json\").read()), 'bytes')
"

source /tmp/vw-ids.env

echo ""
echo "Step 3: Firing enrichment (file-based payload, background)..."
curl -s -X POST https://vallenwood-diagnostic.vercel.app/api/enrich \
  -H "Content-Type: application/json" \
  -H "x-vw-token: vw_prod_9c84f2b1e7a64c3d" \
  --data-binary @/tmp/vw-enrich.json \
  --max-time 300 \
  -o /tmp/vw-enrich-response.json &

echo "Enrichment running in background. Waiting 4 minutes..."
sleep 240

echo ""
echo "Enrich response: $(cat /tmp/vw-enrich-response.json 2>/dev/null || echo none)"
echo ""
echo "═══ REPORT URLS ═══"
echo "Hidden: https://vallenwood-diagnostic.vercel.app/api/report?id=${HIDDEN_ID}&tier=hidden"
[ -n "$AUDIT_ID" ] && echo "Audit:  https://vallenwood-diagnostic.vercel.app/api/report?id=${AUDIT_ID}&tier=audit"
[ -n "$EXEC_ID"  ] && echo "Exec:   https://vallenwood-diagnostic.vercel.app/api/report?id=${EXEC_ID}&tier=exec"
