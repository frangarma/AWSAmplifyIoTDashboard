
import React from 'react';
import ReactDOM from 'react-dom/client'; // <-- Cambiado para React 18
import App from './App';
import { Amplify } from 'aws-amplify';
import awsExports from './aws-exports';
//import '@aws-amplify/ui-react/styles.css';

Amplify.configure(awsExports);

// Crear root usando la nueva API de React 18
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
