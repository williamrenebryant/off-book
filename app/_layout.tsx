import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import 'react-native-reanimated';

// Replace this with your RevenueCat iOS public API key from the dashboard.
// Find it at: app.revenuecat.com → your project → API Keys
const RC_IOS_API_KEY = 'appl_REPLACE_WITH_YOUR_REVENUECAT_IOS_API_KEY';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  useEffect(() => {
    if (Platform.OS === 'ios') {
      Purchases.configure({ apiKey: RC_IOS_API_KEY });
      if (__DEV__) {
        Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
      }
    }
  }, []);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="upload" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="script/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen name="script/[id]/scenes" options={{ headerShown: false }} />
        <Stack.Screen name="script/[id]/practice" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
