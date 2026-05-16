import { useEffect, useRef } from 'react';
import { Platform, StatusBar } from 'react-native';
import { NavigationContainer, useNavigationContainerRef, } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Scout from '@base14/scout-react/native';
import { SongsScreen } from './src/tabs/SongsScreen';
import { SongDetailScreen } from './src/tabs/SongDetailScreen';
import { NewsScreen } from './src/tabs/NewsScreen';
import { ProfileScreen } from './src/tabs/ProfileScreen';
import { SettingsScreen } from './src/tabs/SettingsScreen';
const Tab = createBottomTabNavigator();
const SongsStackNav = createNativeStackNavigator();
function SongsStack() {
    return (<SongsStackNav.Navigator>
      <SongsStackNav.Screen name="Songs" component={SongsScreen}/>
      <SongsStackNav.Screen name="SongDetail" component={SongDetailScreen}/>
    </SongsStackNav.Navigator>);
}
const ENDPOINT = 'http://localhost:34318';
export default function App() {
    const navRef = useNavigationContainerRef();
    const initialized = useRef(false);
    useEffect(() => {
        if (initialized.current)
            return;
        initialized.current = true;
        Scout.initialize({
            serviceName: 'platform-design-mobile',
            serviceVersion: '0.1.0',
            environment: 'local',
            endpoint: ENDPOINT,
            secure: false,
            debug: true,
            firstPartyHosts: ['localhost', '127.0.0.1'],
            metricExportIntervalMs: 2000,
            logExportScheduledDelayMs: 1000,
            traceExportIntervalMs: 2000,
            traceMaxQueueSize: 4096,
            traceMaxExportBatchSize: 256,
            exportTimeoutMs: 5000,
            exportRetry: {
                maxRetries: 5,
                initialDelayMs: 200,
                maxDelayMs: 3000,
            },
            captureConsole: true,
            resourceAttributes: {
                'deployment.region': 'us-east-1',
                team: 'mobile',
            },
            beforeSend: (event) => {
                if (String(event['http.url'] ?? '').includes('/health'))
                    return null;
                delete event['enduser.email'];
                return event;
            },
        })
            .then(() => {
            Scout.setUser('nimish-test-01', {
                email: 'nimish@base14.io',
                name: 'Nimish GJ',
                role: 'developer',
                company: 'Base14',
                platform: Platform.OS,
            });
        })
            .catch(() => {
        });
    }, []);
    return (<SafeAreaProvider>
      <StatusBar barStyle="light-content"/>
      <NavigationContainer ref={navRef} onReady={() => Scout.attachNavigationContainer(navRef)}>
        <Tab.Navigator screenOptions={{
            tabBarActiveTintColor: '#2e7d32',
            headerStyle: { backgroundColor: '#2e7d32' },
            headerTintColor: '#fff',
        }}>
          <Tab.Screen name="SongsTab" component={SongsStack} options={{ title: 'Songs', headerShown: false }}/>
          <Tab.Screen name="News" component={NewsScreen}/>
          <Tab.Screen name="Profile" component={ProfileScreen}/>
          <Tab.Screen name="Settings" component={SettingsScreen}/>
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>);
}
