import React from 'react';

function useAutoScroll(ref) {
  React.useEffect(() => {
    const element = ref.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [ref]);

  return ref;
}

export default useAutoScroll;
