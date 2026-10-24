# ZenUML Enterprise Bundle Integration - Implementation Document

## Document Information

**Project**: Add Enterprise Bundle upgrade option alongside Marketplace
**Version**: 1.0
**Date**: 2025-01-12
**Status**: Ready for Implementation

---

## 1. Executive Summary

### 1.1 Overview
Add a secondary upgrade option (Enterprise Bundle at $199/year) alongside the existing Marketplace upgrade path. The Enterprise Bundle is positioned as an alternative for teams that prefer to pay per space.

### 1.2 Business Context
- **Primary Channel**: Atlassian Marketplace (recommended)
- **Secondary Channel**: Enterprise Bundle via Stripe ($199/year)
- **Target Users**: Teams with <40 users, single space usage, or preference for bundle offerings
- **Pricing**: $16.58-$18.27/month (billed annually at $199 + GST if applicable)
- **Bundle Value**: $578 → $199 (66% savings)

### 1.3 Key Principles
- ✅ Marketplace remains the primary recommendation
- ✅ Enterprise Bundle is a clear "Plan B"
- ✅ Only show when user hits 85+ macros
- ✅ Direct link to Stripe - no intermediate landing page
- ✅ Manual activation process (no API integration needed)

---

## 2. Technical Design

### 2.1 Architecture Overview

```
User reaches 85 macros
        ↓
Action Required button appears
        ↓
User hovers/clicks
        ↓
Tooltip shows 2 options:
  ├─ Marketplace (70% visual weight, primary CTA)
  └─ Enterprise Bundle (30% visual weight, secondary CTA)
        ↓
User clicks one option
        ↓
Opens in new tab:
  ├─ Marketplace: marketplace.atlassian.com
  └─ Enterprise Bundle: buy.stripe.com/[link]
```

### 2.2 Component Structure

```
useCustomerSuccessService (composable)
  ├─ macrosCreated
  ├─ actionRequired
  ├─ upgradeUrl (Marketplace)
  └─ enterpriseBundleUrl (NEW - Stripe)

Upgrade.vue (button component)
  └─ UpgradeTooltip.vue (NEW LAYOUT)
       ├─ Marketplace Section (primary)
       └─ Enterprise Bundle Section (secondary)

Notice/index.vue (banner component)
  └─ Two upgrade links
```

### 2.3 Data Flow

```typescript
// No new API calls needed
// No license validation needed
// No user count fetching needed

composable → provides URLs → component → user clicks → external redirect
```

---

## 3. Implementation Details

### 3.1 File: `src/composables/useCustomerSuccessService.ts`

**Changes Required**: Add Enterprise Bundle URL

**Location**: After `upgradeUrl` computed property

**Code Addition**:
```typescript
const enterpriseBundleUrl = computed(() => {
  return 'https://buy.stripe.com/fZucN67SlgS933i9zd7IY03'
})
```

**Update Return Statement**:
```typescript
return {
  macrosCreated,
  actionRequired,
  upgradeUrl,
  enterpriseBundleUrl, // ADD THIS
  initialize
}
```

**Estimated Time**: 5 minutes

---

### 3.2 File: `src/components/UpgradeTooltip.vue`

**Changes Required**: Complete layout redesign to show two options

#### 3.2.1 Template Structure

```vue
<template>
  <div class="tooltip-container">
    <!-- Marketplace Section (Primary) -->
    <div class="primary-section">
      <div class="recommended-badge">⭐ Recommended</div>
      <h3>Upgrade via Atlassian Marketplace</h3>

      <div class="features">
        ✓ Unlimited macros across all spaces
        ✓ Works for entire organization
        ✓ From $17/month (40 users, billed annually)
      </div>

      <a
        :href="upgradeUrl"
        class="primary-cta"
        @click="trackMarketplaceClick"
      >
        Upgrade on Marketplace →
      </a>
    </div>

    <!-- Divider -->
    <div class="divider">
      <span>Alternative Option</span>
    </div>

    <!-- Enterprise Bundle Section (Secondary) -->
    <div class="secondary-section">
      <h4>Enterprise Bundle</h4>
      <p>If your company prefers to pay for per space</p>

      <!-- Price Display - EMPHASIS ON MONTHLY -->
      <div class="price-display">
        <div class="main-price">$16.58/month</div>
        <div class="sub-price">$199 billed annually</div>
        <div class="savings">Save $379 (66% OFF)</div>
      </div>

      <!-- Bundle Contents -->
      <div class="bundle-contents">
        <div class="item">
          ✓ Unlimited macros in this space
          <span class="value">$200 value</span>
        </div>
        <div class="item">
          ✓ ZenUML Enterprise (app.zenuml.com)
          <span class="value">$199 value</span>
        </div>
        <div class="item">
          ✓ Diagramly Plus (diagramly.ai)
          <span class="value">$179 value</span>
        </div>
      </div>

      <a
        :href="enterpriseBundleUrl"
        class="secondary-cta"
        @click="trackEnterpriseBundleClick"
      >
        Get Enterprise Bundle →
      </a>
    </div>
  </div>
</template>
```

#### 3.2.2 Props Update

```typescript
defineProps<{
  macrosCreated: number
  macrosLimit: number
  upgradeUrl: string
  enterpriseBundleUrl: string // ADD THIS
}>()
```

#### 3.2.3 Event Tracking

```typescript
const trackMarketplaceClick = () => {
  trackEvent('upgrade_marketplace', 'click', 'conversion', {
    source: 'tooltip',
    position: 'primary'
  })
}

const trackEnterpriseBundleClick = () => {
  trackEvent('upgrade_enterprise_bundle', 'click', 'conversion', {
    source: 'tooltip',
    position: 'secondary'
  })
}
```

#### 3.2.4 Styling Notes

**Visual Hierarchy**:
- Primary section: 70% visual weight (larger space, bold button)
- Secondary section: 30% visual weight (smaller space, outline button)

**Key Styles**:
```css
.primary-section {
  background: gradient blue
  padding: larger
}

.primary-cta {
  background: solid blue
  font-weight: bold
  larger size
}

.secondary-cta {
  background: transparent
  border: 2px solid gray
  smaller size
}

.main-price {
  font-size: 36px or larger
  font-weight: bold
}

.savings {
  color: green
  badge style
}
```

**Estimated Time**: 3-4 hours

---

### 3.3 File: `src/components/Upgrade.vue`

**Changes Required**: Pass new prop to UpgradeTooltip

#### 3.3.1 Get URL from Composable

```typescript
const {
  macrosCreated,
  actionRequired,
  upgradeUrl,
  enterpriseBundleUrl, // ADD THIS
  initialize
} = useCustomerSuccessService()
```

#### 3.3.2 Pass to Child Component

```vue
<UpgradeTooltip
  v-if="actionRequired"
  :macros-created="macrosCreated"
  :macros-limit="MACROS_LIMIT"
  :upgrade-url="upgradeUrl"
  :enterprise-bundle-url="enterpriseBundleUrl"
  @click="trackClickEvent"
/>
```

**Estimated Time**: 10 minutes

---

### 3.4 File: `src/components/Notice/index.vue`

**Changes Required**: Add second upgrade link

#### 3.4.1 Get URL from Composable

```typescript
const {
  macrosCreated,
  actionRequired,
  upgradeUrl,
  enterpriseBundleUrl, // ADD THIS
  initialize
} = useCustomerSuccessService()
```

#### 3.4.2 Update Template

```vue
<template>
  <div v-show="actionRequired">
    <div class="bg-orange-50 border-t-4 border-orange-500 ...">
      <div class="flex">
        <div class="py-1">
          <svg>...</svg>
        </div>
        <div>
          <p class="font-bold">
            Action Required: Your space has {{macrosCreated}} macros (limit: {{MACROS_LIMIT}})
          </p>
          <p class="mt-1">
            To continue creating or editing diagrams, please upgrade.
            <a
              @click="trackMarketplaceClick"
              class="font-medium text-blue-600 hover:text-blue-700 underline"
              :href="upgradeUrl"
              target="_blank"
            >
              Upgrade via Marketplace (from $17/mo)
            </a>
            <span class="text-gray-600 mx-1">or</span>
            <a
              @click="trackEnterpriseBundleClick"
              class="font-medium text-blue-600 hover:text-blue-700 underline"
              :href="enterpriseBundleUrl"
              target="_blank"
            >
              Get Enterprise Bundle ($16.58/mo, includes premium tools)
            </a>
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
```

#### 3.4.3 Add Event Tracking

```typescript
const trackMarketplaceClick = () => {
  trackEvent('upgrade_marketplace', 'click', 'conversion', {
    source: 'notice_banner'
  })
}

const trackEnterpriseBundleClick = () => {
  trackEvent('upgrade_enterprise_bundle', 'click', 'conversion', {
    source: 'notice_banner'
  })
}
```

**Estimated Time**: 30 minutes

---

## 4. Testing Plan

### 4.1 Unit Tests

**Not Required** - These are primarily UI and URL changes with no complex logic.

### 4.2 Manual Testing Checklist

#### 4.2.1 Display Tests

**Test Environment**: Local development

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Tooltip not shown before threshold | Create < 85 macros | Upgrade button shows regular state |
| Tooltip shown at threshold | Create 85+ macros | Action Required button appears |
| Marketplace section prominent | Hover over button | Marketplace section larger, more prominent |
| Enterprise Bundle section visible | Scroll tooltip | Enterprise Bundle section visible below |
| Price displays correctly | Check Enterprise Bundle section | Shows $16.58/month or $18.27/month |
| Notice banner shows both links | Check editor/viewer | Both upgrade links present |

#### 4.2.2 Interaction Tests

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Marketplace link works | Click "Upgrade on Marketplace" | Opens Marketplace in new tab |
| Enterprise Bundle link works | Click "Get Enterprise Bundle" | Opens Stripe in new tab |
| Notice Marketplace link works | Click Marketplace link in banner | Opens Marketplace in new tab |
| Notice Enterprise Bundle link works | Click Enterprise Bundle link in banner | Opens Stripe in new tab |
| Tracking fires (Marketplace) | Click Marketplace CTA, check console | Event tracked with correct params |
| Tracking fires (Enterprise Bundle) | Click Enterprise Bundle CTA, check console | Event tracked with correct params |

#### 4.2.3 End-to-End Flow Tests

**Scenario 1: User chooses Marketplace**
1. ✅ User sees Action Required
2. ✅ Hovers/clicks to see options
3. ✅ Sees Marketplace recommended
4. ✅ Clicks "Upgrade on Marketplace"
5. ✅ Redirected to Marketplace
6. ✅ Event tracked correctly

**Scenario 2: User chooses Enterprise Bundle**
1. ✅ User sees Action Required
2. ✅ Hovers/clicks to see options
3. ✅ Sees Enterprise Bundle as alternative
4. ✅ Clicks "Get Enterprise Bundle"
5. ✅ Redirected to Stripe
6. ✅ Completes purchase
7. ✅ Team manually activates within 1 business day

### 5.1 Visual Reference

**Tooltip Layout (ASCII)**:
```
┌─────────────────────────────────────┐
│ ⭐ Recommended                       │
│ Upgrade via Atlassian Marketplace  │
│                                     │
│ ✓ Unlimited across all spaces      │
│ ✓ Entire organization              │
│ ✓ From $17/month                   │
│                                     │
│ [Upgrade on Marketplace →]         │ ← Primary CTA
│                                     │
├─────────────────────────────────────┤
│        Alternative Option           │
├─────────────────────────────────────┤
│                                     │
│ Enterprise Bundle                   │
│ If your company prefers to pay     │
│ per space                          │
│                                     │
│ $16.58/month                       │ ← Emphasized
│ $199 billed annually               │
│ Save $379 (66% OFF)                │
│                                     │
│ ✓ Unlimited in this space ($200)  │
│ ✓ ZenUML Enterprise ($199)         │
│ ✓ Diagramly Plus ($179)            │
│                                     │
│ [Get Enterprise Bundle →]          │ ← Secondary CTA
│                                     │
└─────────────────────────────────────┘
```

### 5.2 Event Tracking Schema

```typescript
interface UpgradeEvent {
  event_name: 'upgrade_marketplace' | 'upgrade_enterprise_bundle'
  event_category: 'click' | 'impression' | 'hover'
  event_label: 'conversion'
  event_properties: {
    source: 'tooltip' | 'notice_banner'
    position: 'primary' | 'secondary'
    macros_created: number
    action_required: boolean
  }
}
```

