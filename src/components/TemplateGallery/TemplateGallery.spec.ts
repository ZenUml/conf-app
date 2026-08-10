import { mount } from '@vue/test-utils';
import TemplateGallery from './TemplateGallery.vue';
import { DiagramType } from '@/model/Diagram/Diagram';
import { getTemplatesForType } from '@/model/Diagram/EditorTemplates';

describe('TemplateGallery', () => {
  it('renders nothing when not visible', () => {
    const wrapper = mount(TemplateGallery, {
      props: { visible: false, diagramType: DiagramType.Sequence },
    });
    expect(wrapper.find('[data-testid="template-gallery"]').exists()).toBe(false);
  });

  it('renders one card per template for the given diagram type', () => {
    const wrapper = mount(TemplateGallery, {
      props: { visible: true, diagramType: DiagramType.Sequence },
    });
    const expected = getTemplatesForType(DiagramType.Sequence);
    const cards = wrapper.findAll('[data-testid="template-card"]');
    expect(cards).toHaveLength(expected.length);
    expect(wrapper.text()).toContain(expected[0].name);
    expect(wrapper.text()).toContain(expected[0].description);
  });

  it('switches its template list when diagramType prop changes', async () => {
    const wrapper = mount(TemplateGallery, {
      props: { visible: true, diagramType: DiagramType.Sequence },
    });
    await wrapper.setProps({ diagramType: DiagramType.Mermaid });
    const expected = getTemplatesForType(DiagramType.Mermaid);
    expect(wrapper.findAll('[data-testid="template-card"]')).toHaveLength(expected.length);
  });

  it('emits "select" with the clicked template and nothing else on card click', async () => {
    const wrapper = mount(TemplateGallery, {
      props: { visible: true, diagramType: DiagramType.Sequence },
    });
    const templates = getTemplatesForType(DiagramType.Sequence);
    const useButtons = wrapper.findAll('[data-testid="template-use-button"]');
    expect(useButtons).toHaveLength(templates.length);

    await useButtons[2].trigger('click');

    expect(wrapper.emitted('select')).toHaveLength(1);
    expect(wrapper.emitted('select')![0]).toEqual([templates[2]]);
  });

  it('emits "close" when the close button is clicked', async () => {
    const wrapper = mount(TemplateGallery, {
      props: { visible: true, diagramType: DiagramType.Sequence },
    });
    await wrapper.find('[data-testid="template-gallery-close"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('emits "close" when the backdrop (outside the panel) is clicked', async () => {
    const wrapper = mount(TemplateGallery, {
      props: { visible: true, diagramType: DiagramType.Sequence },
      attachTo: document.body,
    });
    await wrapper.find('[data-testid="template-gallery-backdrop"]').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
