import type { Meta, StoryObj } from "@storybook/vue3-vite";
import React from "react";
import ReactDOM from "react-dom";
import { defineComponent, h, onBeforeUnmount, onMounted, type PropType, ref, watch } from "vue";
import AIChatPanel, { type AIChatMessage } from "./AIChatPanel";

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
    initialMessages: {
      type: Array as PropType<AIChatMessage[]>,
      default: () => [],
    },
    syntaxError: {
      type: String,
      default: "",
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
          initialMessages: props.initialMessages,
          syntaxError: props.syntaxError,
          onClose: () => {},
          onToggleCode: () => {},
        }),
        mountPoint.value,
      );
    };

    onMounted(renderReactPanel);
    watch(() => [props.diagramType, props.prototypeMode, props.initialMessages, props.syntaxError], renderReactPanel, {
      deep: true,
    });
    onBeforeUnmount(() => {
      if (mountPoint.value) ReactDOM.unmountComponentAtNode(mountPoint.value);
    });

    return () =>
      h(
        "div",
        {
          class: "border-r border-slate-200 shadow-lg",
          style: { width: "368px", height: "100vh" },
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
          "React implementation of the guided AI diagram editing workflow used by the Forge OpenAPI editor.",
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

export const ChangeReady: Story = {
  args: {
    diagramType: "openapi",
    prototypeMode: true,
    initialMessages: [
      {
        id: "user-ready",
        role: "user",
        text: "Add an error response",
      },
      {
        id: "assistant-ready",
        role: "assistant",
        text: "I prepared a focused update that keeps the current API structure intact.",
        preview: {
          title: "Update ready",
          items: [
            "Keep the current OpenAPI format",
            "Preserve existing operations and schemas",
            "Add a documented error response",
          ],
        },
      },
    ],
  },
};

export const WithSyntaxIssue: Story = {
  args: {
    diagramType: "openapi",
    syntaxError: "OpenAPI syntax error: unexpected token at line 8, column 14",
    prototypeMode: true,
  },
};
