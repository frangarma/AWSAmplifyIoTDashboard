// src/App.js
import React, { useState, useEffect } from 'react';
import './App.css';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import logo from './file.png'; // Asegúrate de que file.png está en src/

function App() {
  const [showWelcome, setShowWelcome] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowWelcome(false), 4000); // Oculta saludo tras 4 segundos
    return () => clearTimeout(timer);
  }, []);


  return (
    <Authenticator
       hideSignUp // 🔒 Esto desactiva la opción "Create Account"
      components={{
        Header() {
          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
             
              backgroundColor: '' // fondo claro

            }}>
              <img src={logo} alt="logo" style={{ height: '60px', marginRight: '15px' }} />
              <h2 style={{ color: '#22c55e' }}>Smart-Things</h2>
            </div>
          );
        }
      }}
    >
      {({ signOut, user }) => (
        <div className="App">
          <header className="App-header">
            <div className="logo-container">
              <img src={logo} className="App-logo" alt="logo" />
              <span className="logo-text">Smart-Things</span>
            </div>
            {showWelcome && <h2>Bienvenido, {user.username}!</h2>}
          </header>

          <main>
            <h3>Control de dispositivos</h3>
            <div>
              <button onClick={() => sendCommand('d_000', 'on')}>🔌 Encender reles</button>
              <button onClick={() => sendCommand('d_000', 'off')}>⛔ Apagar reles</button>
            </div>
          </main>

          <button className="logout-button" onClick={signOut}>Cerrar sesión</button>
        </div>
      )}
    </Authenticator>
  );
}

// Function to send commands
async function sendCommand(deviceId, value) {
  try {
    const response = await fetch('https://kl7d93xve4.execute-api.eu-west-1.amazonaws.com/dev/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        deviceId,
        path: 'ks/set',
        value
      })
    });
    const data = await response.json();
    // alert(`Comando enviado: ${value}`); // Desactivado para interfaz limpia
  } catch (error) {
    console.error('Error enviando comando:', error);
    // alert('Error enviando comando'); // Desactivado para interfaz limpia
  }
}

export default App;
