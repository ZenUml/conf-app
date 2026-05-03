import { ref, computed } from 'vue'

// Pricing tier breakpoints and rates
const PRICING_TIERS = {
  FLAT_RATE_MAX: 10,
  SMALL_TIER_MAX: 100,
  MEDIUM_TIER_MAX: 250,
  LARGE_TIER_MAX: 1000,
  ENTERPRISE_TIER_MAX: 2500,
  MAX_USERS: 10000,
} as const

const PRICING_RATES = {
  FLAT_RATE: 40, // Total annual cost for up to 10 users
  SMALL_TIER: 0.44, // per user per month
  MEDIUM_TIER: 0.33,
  LARGE_TIER: 0.11,
  ENTERPRISE_TIER: 0.05,
} as const

const MONTHS_IN_YEAR = 10 // Annual pricing = 10 months (2 months free)

// Slider breakpoint percentages (logarithmic distribution)
const SLIDER_BREAKPOINTS = {
  TIER_1_END: 9, // 0-9: 10-100 users
  TIER_2_END: 24, // 10-24: 101-250 users
  TIER_3_END: 62, // 25-62: 251-1000 users
  // 63-100: 1001-10000 users
} as const

export function usePricingCalculator(defaultUsers = 50) {
  const confluenceUsers = ref<number>(defaultUsers)
  const sliderValue = ref<number>(0)
  const hasCalculated = ref(false)

  // Logarithmic scale mapping for better precision at lower user counts
  const sliderToUsers = (value: number): number => {
    if (value <= SLIDER_BREAKPOINTS.TIER_1_END) {
      // 0-9: maps to 10-100 users
      return Math.round(10 + (value / SLIDER_BREAKPOINTS.TIER_1_END) * 90)
    } else if (value <= SLIDER_BREAKPOINTS.TIER_2_END) {
      // 10-24: maps to 101-250 users
      return Math.round(100 + ((value - SLIDER_BREAKPOINTS.TIER_1_END) / (SLIDER_BREAKPOINTS.TIER_2_END - SLIDER_BREAKPOINTS.TIER_1_END)) * 150)
    } else if (value <= SLIDER_BREAKPOINTS.TIER_3_END) {
      // 25-62: maps to 251-1000 users
      return Math.round(250 + ((value - SLIDER_BREAKPOINTS.TIER_2_END) / (SLIDER_BREAKPOINTS.TIER_3_END - SLIDER_BREAKPOINTS.TIER_2_END)) * 750)
    } else {
      // 63-100: maps to 1001-10000 users
      return Math.round(1000 + ((value - SLIDER_BREAKPOINTS.TIER_3_END) / (100 - SLIDER_BREAKPOINTS.TIER_3_END)) * 9000)
    }
  }

  const usersToSlider = (users: number): number => {
    if (users <= PRICING_TIERS.SMALL_TIER_MAX) {
      return Math.round(((users - 10) / 90) * SLIDER_BREAKPOINTS.TIER_1_END)
    } else if (users <= PRICING_TIERS.MEDIUM_TIER_MAX) {
      return Math.round(SLIDER_BREAKPOINTS.TIER_1_END + ((users - PRICING_TIERS.SMALL_TIER_MAX) / 150) * (SLIDER_BREAKPOINTS.TIER_2_END - SLIDER_BREAKPOINTS.TIER_1_END))
    } else if (users <= PRICING_TIERS.LARGE_TIER_MAX) {
      return Math.round(SLIDER_BREAKPOINTS.TIER_2_END + ((users - PRICING_TIERS.MEDIUM_TIER_MAX) / 750) * (SLIDER_BREAKPOINTS.TIER_3_END - SLIDER_BREAKPOINTS.TIER_2_END))
    } else {
      return Math.round(SLIDER_BREAKPOINTS.TIER_3_END + ((users - PRICING_TIERS.LARGE_TIER_MAX) / 9000) * (100 - SLIDER_BREAKPOINTS.TIER_3_END))
    }
  }

  // Calculate Marketplace annual cost based on pricing tiers (cumulative pricing)
  const marketplaceAnnualCost = computed(() => {
    const users = confluenceUsers.value
    let cost = 0

    if (users <= PRICING_TIERS.FLAT_RATE_MAX) {
      return PRICING_RATES.FLAT_RATE
    }

    // Tier 1: 11-100 users @ $0.44/user/month
    if (users <= PRICING_TIERS.SMALL_TIER_MAX) {
      cost = users * PRICING_RATES.SMALL_TIER * MONTHS_IN_YEAR
    } else {
      cost = PRICING_TIERS.SMALL_TIER_MAX * PRICING_RATES.SMALL_TIER * MONTHS_IN_YEAR

      // Tier 2: 101-250 users @ $0.33/user/month
      if (users <= PRICING_TIERS.MEDIUM_TIER_MAX) {
        cost += (users - PRICING_TIERS.SMALL_TIER_MAX) * PRICING_RATES.MEDIUM_TIER * MONTHS_IN_YEAR
      } else {
        cost += (PRICING_TIERS.MEDIUM_TIER_MAX - PRICING_TIERS.SMALL_TIER_MAX) * PRICING_RATES.MEDIUM_TIER * MONTHS_IN_YEAR

        // Tier 3: 251-1000 users @ $0.11/user/month
        if (users <= PRICING_TIERS.LARGE_TIER_MAX) {
          cost += (users - PRICING_TIERS.MEDIUM_TIER_MAX) * PRICING_RATES.LARGE_TIER * MONTHS_IN_YEAR
        } else {
          cost += (PRICING_TIERS.LARGE_TIER_MAX - PRICING_TIERS.MEDIUM_TIER_MAX) * PRICING_RATES.LARGE_TIER * MONTHS_IN_YEAR

          // Tier 4: 1001-2500 users @ $0.05/user/month
          if (users <= PRICING_TIERS.ENTERPRISE_TIER_MAX) {
            cost += (users - PRICING_TIERS.LARGE_TIER_MAX) * PRICING_RATES.ENTERPRISE_TIER * MONTHS_IN_YEAR
          } else {
            cost += (PRICING_TIERS.ENTERPRISE_TIER_MAX - PRICING_TIERS.LARGE_TIER_MAX) * PRICING_RATES.ENTERPRISE_TIER * MONTHS_IN_YEAR

            // Tier 5: 2501-10000 users @ $0.05/user/month
            cost += (users - PRICING_TIERS.ENTERPRISE_TIER_MAX) * PRICING_RATES.ENTERPRISE_TIER * MONTHS_IN_YEAR
          }
        }
      }
    }

    return Math.round(cost)
  })

  // Current tier name based on user count
  const currentTierName = computed(() => {
    const u = confluenceUsers.value
    if (u <= PRICING_TIERS.FLAT_RATE_MAX) return 'Flat Rate'
    if (u <= PRICING_TIERS.SMALL_TIER_MAX) return 'Small Tier'
    if (u <= PRICING_TIERS.MEDIUM_TIER_MAX) return 'Medium Tier'
    if (u <= PRICING_TIERS.LARGE_TIER_MAX) return 'Large Tier'
    return 'Enterprise Tier'
  })

  // Current rate per user
  const currentRate = computed(() => {
    const u = confluenceUsers.value
    if (u <= PRICING_TIERS.FLAT_RATE_MAX) return '0.40' // $40/year ÷ 10 users ÷ 10 months
    if (u <= PRICING_TIERS.SMALL_TIER_MAX) return '0.44'
    if (u <= PRICING_TIERS.MEDIUM_TIER_MAX) return '0.33'
    if (u <= PRICING_TIERS.LARGE_TIER_MAX) return '0.11'
    return '0.05'
  })

  // Initialize slider position based on default user count
  sliderValue.value = usersToSlider(confluenceUsers.value)

  const handleSliderChange = () => {
    confluenceUsers.value = sliderToUsers(sliderValue.value)
    hasCalculated.value = true
  }

  // Auto-calculate on mount
  hasCalculated.value = true

  return {
    confluenceUsers,
    sliderValue,
    hasCalculated,
    marketplaceAnnualCost,
    currentTierName,
    currentRate,
    handleSliderChange,
  }
}
