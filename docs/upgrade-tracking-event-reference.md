# Upgrade Tracking Events - Quick Reference

| Scenario | `event_label` | `action` | `product_option` | `ui_component` | `cta_position` |
|----------|---------------|----------|------------------|----------------|----------------|
| Tooltip → Marketplace | `upgrade_cta_clicked` | `click` | `marketplace` | `tooltip` | `primary` |
| Tooltip → Enterprise | `upgrade_cta_clicked` | `click` | `enterprise_bundle` | `tooltip` | `secondary` |
| Header Badge Click | `upgrade_cta_clicked` | `click` | `marketplace` | `header_badge` | - |
| Header Badge Hover | `upgrade_prompt_hovered` | `hover` | - | `header_badge` | - |
| Banner → Marketplace | `upgrade_cta_clicked` | `click` | `marketplace` | `banner` | - |
| Banner → Enterprise | `upgrade_cta_clicked` | `click` | `enterprise_bundle` | `banner` | - |
| Viewer Notice → Marketplace (Lite only) | `upgrade_cta_clicked` | `click` | `marketplace` | `viewer_notice` | - |
| Viewer Notice → Enterprise (Lite only) | `upgrade_cta_clicked` | `click` | `enterprise_bundle` | `viewer_notice` | - |
| Feature Enabled | `upgrade_feature_enabled` | `system` | - | - | - |

---

## Enum Values Reference

### `product_option`
- `marketplace` - Atlassian Marketplace upgrade
- `enterprise_bundle` - Enterprise Bundle (Stripe)
- `unknown` - Not applicable or unknown

### `ui_component`
- `header_badge` - Header "Upgrade" or "Action Required" badge
- `tooltip` - Hover tooltip on Action Required badge
- `banner` - Warning banner in editor
- `viewer_notice` - Notice in viewer for non-admins (Lite version only)

### `cta_position`
- `primary` - Primary/recommended option (left column, blue)
- `secondary` - Secondary/alternative option (right column, gray)

---

## SQL Query Examples

### Count clicks by product option
```sql
SELECT
  product_option,
  COUNT(*) as clicks
FROM events
WHERE event_label = 'upgrade_cta_clicked'
GROUP BY product_option;
```

### Count clicks by UI location
```sql
SELECT
  ui_component,
  COUNT(*) as clicks
FROM events
WHERE event_label = 'upgrade_cta_clicked'
GROUP BY ui_component
ORDER BY clicks DESC;
```

### Analyze conversion by macro usage stage
```sql
SELECT
  CASE
    WHEN macro_usage_pct < 90 THEN '85-89%'
    WHEN macro_usage_pct < 95 THEN '90-94%'
    WHEN macro_usage_pct < 100 THEN '95-99%'
    ELSE '100%+'
  END as usage_stage,
  COUNT(*) as clicks,
  AVG(macro_count) as avg_macros
FROM events
WHERE event_label = 'upgrade_cta_clicked'
GROUP BY usage_stage
ORDER BY usage_stage;
```

### Compare Marketplace vs Enterprise Bundle performance
```sql
SELECT
  product_option,
  ui_component,
  COUNT(*) as clicks,
  AVG(macro_usage_pct) as avg_usage
FROM events
WHERE event_label = 'upgrade_cta_clicked'
  AND product_option IN ('marketplace', 'enterprise_bundle')
GROUP BY product_option, ui_component
ORDER BY clicks DESC;
```

---

## Implementation Reference

```typescript
// Example: Track Marketplace click from tooltip
trackUpgradeEvent(UpgradeEventName.CTA_CLICKED, {
  product_option: ProductOption.MARKETPLACE,
  ui_component: UIComponent.TOOLTIP,
  cta_position: 'primary',
  ...getUpgradeContext(),  // Adds macro_count, macro_limit, macro_usage_pct
})
```
