# Video System — Matching Rules

## Stage 1: Deterministic (confidence = 1.0)

Applies to all three sources.

- **Studio analytics**: post_id → look up video_master.tiktok_video_id. Always matches (IDs are identical).
- **Perf stats**: video_id_raw → look up video_master.tiktok_video_id. Always matches.
- **Affiliate**: content_id → look up video_master.tiktok_video_id. Matches for video-type content.

Result: match_stage=1, confidence_score=1.0, match_status='matched'

## Stage 3a: ID Normalization (confidence = 0.90)

Applies only to affiliate content_ids that failed Stage 1.

Normalization: strip leading zeros, trim whitespace, lowercase.

If the normalized form matches a video_master.tiktok_video_id → matched.

Result: match_stage=3, confidence_score=0.90, match_status='matched'

## Stage 3b: Product + Date Heuristic (confidence = 0.75 / 0.50)

Applies only to affiliate content_ids that failed Stage 1 and 3a.

Algorithm:
1. Find all product_ids sold by this content_id via content_order_facts
2. Find earliest order_date for this content_id
3. Build 30-day window: [earliest_order_date - 30d, earliest_order_date + 30d]
4. Find other content_ids in content_order_facts that sold the SAME product_ids within this window
5. Filter to only those already-matched content_ids (match_status='matched' in video_source_mapping)
6. Resolve to canonical_ids via video_source_mapping
7. Filter those canonical videos to those with posted_at within the same 30-day window

Outcomes:
- 0 matching videos → status='unmatched'
- 1 matching video → status='needs_review', confidence=0.75, match_stage=3
- 2+ matching videos → status='conflict', confidence=0.50, match_stage=3, canonical_id=NULL

## Unmatched

No stage matched. Stored with match_status='unmatched', canonical_id=NULL.

Common reasons: live stream IDs, showcase content, old content not yet imported into video_master.

## Status Definitions

| status | Meaning |
|--------|---------|
| matched | Deterministic or high-confidence match. Safe to use. |
| unmatched | No match found. Affiliate data not attributed to any video. |
| needs_review | Heuristic match with 1 candidate. Human should confirm. |
| conflict | Heuristic produced 2+ candidates. Human must resolve. |

## Human Review

Use the Mapping Review page (`/content-ops/video-mapping-review`) to:
- View all unmatched / needs_review / conflict mappings
- Confirm: sets match_status='matched', confidence=1.0, match_stage=3, reason='manual:confirmed'
- Reject: sets match_status='unmatched', canonical_id=NULL, reason='manual:rejected'
