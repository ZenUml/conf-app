# Forge Get Started Page Implementation

## Overview

This document describes the implementation of the "Get Started" page for the ZenUML Forge app using the `confluence:globalSettings` module, following the official [Atlassian Forge documentation](https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-global-settings/).

## Implementation Details

### 1. Manifest Configuration

**File**: `manifest.yml`

Added the global settings module configuration with `useAsGetStarted: true`:

```yaml
confluence:globalSettings:
  - key: zenuml-get-started-settings
    title: ZenUML Get Started
    resource: main
    useAsGetStarted: true
```

According to the [Forge documentation](https://developer.atlassian.com/platform/forge/manifest-reference/modules/confluence-global-settings/), this configuration:
- Creates a global settings module that appears in the Confluence admin interface
- Sets `useAsGetStarted: true` to make it the app's "Get Started" page
- The page will be shown within the app section on the "Manage Apps" page
- It will also appear in the dialog shown when an admin successfully installs the app

### 2. Get Started Component

**File**: `src/components/GetStarted/GetStarted.vue`

A comprehensive Vue component that provides:

#### Features:
- **Hero Section**: Welcome message with call-to-action buttons
- **Feature Cards**: Overview of all available diagram types
- **Tutorial Section**: Step-by-step guide with embedded video
- **Resources Section**: Links to documentation, tutorials, community, and support
- **Responsive Design**: Works on desktop and mobile devices

#### Content Sections:
1. **Hero Section**: Welcome message and primary actions
2. **What You Can Do**: Feature cards for each diagram type
   - Sequence Diagrams (ZenUML & Mermaid)
   - Graph Diagrams (DrawIO-powered)
   - OpenAPI Specifications
   - Embed Existing Content
3. **Quick Start Tutorial**: Video tutorial and step-by-step guide
4. **Resources & Support**: Documentation, videos, community, and issue reporting
5. **Footer**: Final call-to-action

### 3. Route Handler

**File**: `src/routes/getStarted.ts`

Handles the global settings route and initializes the Vue app:

```typescript
export async function handleGetStartedRoute() {
  // Initialize context
  await globals.apWrapper.initializeContext();
  
  // Track page view
  trackEvent('', 'get_started_route_accessed', 'forge_get_started', {
    page_type: 'global_settings_get_started',
    version: '2025.04'
  });
  
  // Create and mount Vue app
  const app = createApp(GetStarted);
  app.mount(container);
}
```

### 4. Main App Integration

**File**: `src/forgeIndex.ts`

Updated the main Forge app to detect and handle the global settings route:

```typescript
// Check if this is a global settings route (get started page)
const context = await initForgeContext();
if (context.extension?.type === 'confluence:globalSettings') {
  await handleGetStartedRoute();
  return { macroData: null };
}
```

## User Experience

### 1. Accessing the Get Started Page

Users can access the get started page through:
- **Post-Installation**: Automatically shown when the app is installed
- **Manage Apps**: Confluence Admin → Manage apps → ZenUML → Get Started
- **Direct Navigation**: Available in the app's admin interface

### 2. Page Features

#### Interactive Elements:
- **Call-to-Action Buttons**: Guide users to create their first diagram
- **Feature Cards**: Showcase each diagram type with descriptions
- **Tutorial Video**: Embedded YouTube tutorial
- **Resource Links**: Direct links to documentation and support

#### User Guidance:
- **Step-by-Step Tutorial**: Clear instructions for getting started
- **Visual Design**: Professional, modern interface
- **Responsive Layout**: Works on all device sizes

### 3. Analytics Integration

Comprehensive event tracking for user interactions:

#### Events Tracked:
- `get_started_page_view`: When user visits the page
- `get_started_route_accessed`: When route is accessed
- `get_started_create_first_diagram`: When user clicks primary CTA
- `get_started_create_sequence`: When user chooses sequence diagrams
- `get_started_create_graph`: When user chooses graph diagrams
- `get_started_create_openapi`: When user chooses OpenAPI diagrams
- `get_started_create_embed`: When user chooses embed diagrams
- `get_started_view_docs`: When user clicks documentation link

#### Context Data:
- `page_type`: Identifies this as a global settings get started page
- `version`: App version for tracking

## Technical Implementation

### 1. Forge Module Type

Using `confluence:globalSettings` instead of `confluence:globalPage`:
- **Advantage**: Automatically integrates with Confluence admin interface
- **Get Started Integration**: `useAsGetStarted: true` makes it the official get started page
- **Navigation**: Appears in the left navigation menu in Confluence global settings

### 2. Component Architecture

#### Vue Component Structure:
```vue
<template>
  <div class="get-started-page">
    <!-- Hero Section -->
    <!-- Features Section -->
    <!-- Tutorial Section -->
    <!-- Resources Section -->
    <!-- Footer Section -->
  </div>
</template>
```

#### Styling:
- **Modern Design**: Clean, professional appearance
- **Responsive Grid**: CSS Grid for feature cards and resources
- **Interactive Elements**: Hover effects and transitions
- **Mobile-First**: Responsive design for all screen sizes

### 3. Route Detection

The app detects the global settings route using:
```typescript
if (context.extension?.type === 'confluence:globalSettings') {
  await handleGetStartedRoute();
  return { macroData: null };
}
```

## Content Strategy

### 1. Welcome Message
- Clear value proposition
- Forge-specific branding
- Call-to-action buttons

### 2. Feature Overview
- All four diagram types covered
- Clear descriptions and benefits
- Direct action buttons for each type

### 3. Tutorial Content
- Embedded video tutorial
- Step-by-step written guide
- Visual numbered steps

### 4. Support Resources
- Documentation links
- Community resources
- Issue reporting
- Video tutorials

## Benefits of This Implementation

### 1. Forge-Native Integration
- Follows official Forge documentation patterns
- Integrates seamlessly with Confluence admin interface
- Automatic post-installation display

### 2. User Experience
- Professional, modern interface
- Clear guidance for new users
- Comprehensive resource links
- Interactive elements

### 3. Analytics and Tracking
- Complete user journey tracking
- Event-based analytics
- Performance monitoring

### 4. Maintainability
- Modular component structure
- Clear separation of concerns
- Easy to update content

## Future Enhancements

### 1. Content Updates
- Update tutorial video links
- Add more interactive elements
- Include user testimonials

### 2. Feature Additions
- Interactive demos
- Progress tracking
- Personalized recommendations

### 3. Integration
- Connect with actual macro creation
- Deep linking to specific features
- User onboarding flow

## Testing

### Manual Testing:
- Verify page loads correctly in Forge environment
- Test all interactive elements
- Validate analytics events
- Check responsive design

### User Acceptance Testing:
- Test with actual Confluence administrators
- Verify post-installation flow
- Validate user guidance effectiveness

This implementation provides a comprehensive, Forge-native get started experience that follows Atlassian's best practices and provides users with everything they need to begin using ZenUML effectively.
