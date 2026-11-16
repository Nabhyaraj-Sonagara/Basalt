// The design-system bundle is an IIFE that reads React from window.React.
// This module must be imported before ./generated/bundle.js.
import React from 'react';

(window as unknown as { React: typeof React }).React = React;
