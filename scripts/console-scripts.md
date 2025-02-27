## Create a flag

```typescript
  flag = AP.flag.create({
  title: 'New version of ZenUML add-on installed',
  body: 'You can embed existing diagrams and Open API specifications now. Use `/embed` to insert the macro.',
  type: 'info',
  actions: {
    'seeHowItWorks': 'See how it works',
    'noThanks': 'No thanks'
  }
});
```

## Get page content
