import { useEffect, useRef } from 'react';
import { Platform, StatusBar } from 'react-native';
import { NavigationContainer, useNavigationContainerRef, } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Scout from '@base-14/scout-react';
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
const ENDPOINT = Platform.OS === 'android'
    ? 'http://10.0.2.2:4318'
    : 'http://localhost:4318';
const AUTH_TOKEN = '';
const TRAINER_FIRST = ['Ash', 'Misty', 'Brock', 'Serena', 'Dawn', 'Iris', 'Hilda', 'May'];
const TRAINER_LAST = ['Ketchum', 'Oak', 'Birch', 'Elm', 'Rowan', 'Cynthia', 'Steven', 'Lance'];
const TRAINER_ROLES = ['rookie', 'veteran', 'champion', 'gym-leader', 'professor'];
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomTrainer() {
    const first = pick(TRAINER_FIRST);
    const last = pick(TRAINER_LAST);
    const role = pick(TRAINER_ROLES);
    const tag = Math.random().toString(36).slice(2, 8);
    return {
        id: `trainer-${tag}`,
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}.${tag}@example.dev`,
        role,
    };
}
export default function App() {
    const navRef = useNavigationContainerRef();
    const initialized = useRef(false);
    useEffect(() => {
        if (initialized.current)
            return;
        initialized.current = true;
        const trainer = randomTrainer();
        Scout.initialize({
            serviceName: 'platform-design-mobile',
            environment: 'local',
            endpoint: ENDPOINT,
            secure: false,
            debug: true,
            firstPartyHosts: [],
            sessionSampleRate: 100,
            maxSessionDurationMinutes: 5,
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
                delete event['user.email'];
                return event;
            },
        })
            .then(() => {
            Scout.setUser(trainer.id, {
                email: trainer.email,
                name: trainer.name,
                role: trainer.role,
                company: 'Base14',
                platform: Platform.OS,
            });
        })
            .catch(() => {
        });
    }, []);
    return (<SafeAreaProvider>
      <StatusBar barStyle="light-content"/>
      <NavigationContainer ref={navRef} onReady={() => {
        if (typeof (Scout as any).attachNavigationContainer === 'function') {
            (Scout as any).attachNavigationContainer(navRef);
        }
    }}>
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
