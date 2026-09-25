# AWS hosting after t3.micro free-tier expiry (Mumbai)

**Query / research question:** Current AWS cost and sizing for Delphic One after an EC2 `t3.micro` free-tier year: Compose stack (Postgres 16 + Node + nginx) plus Cloudflare Tunnel; immediate restore vs later ERP/payroll/multi-company path; region `ap-south-1`.

**Tool:** `perplexity_research`

**As-of timestamp:** 2026-09-14

**Source URLs / citations:**

- [AWS EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/)
- [AWS T3 instance types](https://aws.amazon.com/ec2/instance-types/t3/)
- [AWS Lightsail pricing](https://aws.amazon.com/lightsail/pricing/)
- [Lightsail bundles](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html)
- [AWS EBS pricing](https://aws.amazon.com/ebs/pricing/)
- [Public IPv4 charge](https://aws.amazon.com/blogs/aws/new-aws-public-ipv4-address-charge-public-ip-insights/)
- [Avoid charges after free tier](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/avoid-charges-after-free-tier.html)
- [Cloudflare Error 1033](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1033/)
- [Cloudflare Tunnel common errors](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/troubleshoot-tunnels/common-errors/)
- [Amazon SES pricing](https://aws.amazon.com/ses/pricing/)
- [AWS India tax help](https://aws.amazon.com/tax-help/india/)
- Supporting indexes used by the research pass: doit.com, cloudprice.net, vantage.sh for Mumbai T3/RDS hourly rates. Confirm in the AWS Pricing Calculator before purchase.

## Distilled findings

### Free-tier expiry

The instance does not stop by itself when the 12-month free tier ends. It keeps running and standard rates apply. Compute stops billing only if you stop or terminate the instance. EBS, snapshots, and a public IPv4 can still bill after stop.

Error 1033 means Cloudflare has no healthy `cloudflared` connector. Free-tier expiry causes that only if the account was suspended or someone stopped the VM. OOM on 1 GiB RAM is a plausible cause for this stack: Ubuntu, Docker, Postgres, Node, nginx, and `cloudflared` share 1 GiB.

### Mumbai On-Demand estimates (730 hours, Linux)

Rates used by the research pass: `t3.micro` about $0.0112/h, `t3.small` about $0.0224/h, `t3.medium` about $0.0448/h. Plus gp3 about $0.0912/GB-month, public IPv4 $0.005/hour (~$3.65/mo), snapshots about $0.05/GB-month stored.

| Size | RAM | Estimated monthly before GST (20–30 GB gp3 + IPv4 + one snapshot) |
|---|---|---|
| `t3.micro` | 1 GiB | about $15–$16 |
| `t3.small` | 2 GiB | about $23–$24 |
| `t3.medium` | 4 GiB | about $39–$41 |

India GST is generally 18% on AWS India invoices. A GST-registered company may claim ITC. Confirm GSTIN in AWS Tax Settings.

### Lightsail (cheaper VPS, migration cost)

Published Linux bundles: 2 GB $12, 4 GB $24, 8 GB $44. Mumbai gets half the headline transfer allowance; the listed bundle price is not published higher on the Lightsail pricing page. Lightsail is cheaper than equivalent EC2 plus disk plus IPv4. Resizing the existing EC2 instance is faster during an outage than migrating to Lightsail.

### Memory

`t3.micro` (1 GiB) can run this Compose stack only with tight limits and swap. It is not a reliable production size. Practical minimum is `t3.small` (2 GiB) plus about 2 GiB swap. Comfortable size for reports, backups, and `cloudflared` is `t3.medium` (4 GiB).

### RDS and SES

Keep Postgres in Compose until payroll or multi-company financials need PITR and isolation. Indicative Mumbai RDS compute: `db.t3.micro` about $19/mo, `db.t3.small` about $39/mo, plus storage. SES outbound is $0.10 per 1,000 emails. Skip ALB and EKS at this scale.

## Decision impact

- Immediate restore: resize the existing EC2 `t3.micro` to `t3.small` in place. Budget about $23–$24/month before GST, or about $27–$29 with 18% GST. Restart and enable `cloudflared`. Add swap. Keep Compose Postgres.
- If memory spikes already happen during imports or reports: go to `t3.medium` now (~$39–$41 before GST).
- Do not buy RDS, ALB, or EKS this week.
- Later ERP/payroll/four-company financials: app on `t3.medium`, RDS `db.t3.small` Single-AZ first, Multi-AZ when payroll is production-critical.
- Confirm prices in the AWS Pricing Calculator for `ap-south-1` immediately before purchase. Catalog pages are dynamic.
