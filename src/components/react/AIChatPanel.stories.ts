import type { Meta, StoryObj } from "@storybook/vue3-vite";
import React from "react";
import ReactDOM from "react-dom";
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AIChatPanel from "./AIChatPanel";

const ReactAIChatPanelPreview = defineComponent({
  name: "ReactAIChatPanelPreview",
  props: {
    diagramType: {
      type: String,
      default: "openapi",
    },
    prototypeMode: {
      type: Boolean,
      default: true,
    },
  },
  setup(props) {
    const mountPoint = ref<HTMLElement | null>(null);

    const renderReactPanel = () => {
      if (!mountPoint.value) return;
      ReactDOM.render(
        React.createElement(AIChatPanel, {
          open: true,
          diagramType: props.diagramType,
          prototypeMode: props.prototypeMode,
          onClose: () => {},
        }),
        mountPoint.value,
      );
    };

    onMounted(renderReactPanel);
    watch(() => [props.diagramType, props.prototypeMode], renderReactPanel);
    onBeforeUnmount(() => {
      if (mountPoint.value) ReactDOM.unmountComponentAtNode(mountPoint.value);
    });

    return () =>
      h(
        "div",
        {
          class: "border-r border-slate-200 shadow-lg",
          style: { width: "360px", height: "100vh" },
        },
        [h("div", { ref: mountPoint, style: { height: "100%" } })],
      );
  },
});

const meta: Meta<typeof ReactAIChatPanelPreview> = {
  title: "AI/ReactAIChatPanel",
  component: ReactAIChatPanelPreview,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "React implementation used by the Forge OpenAPI/Swagger editor. Preview mode demonstrates the UI without calling an AI backend.",
      },
    },
  },
};

export default meta;

type Story = StoryObj<typeof ReactAIChatPanelPreview>;

export const OpenAPI: Story = {
  args: {
    diagramType: "openapi",
    prototypeMode: true,
  },
};
