"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, Loader2, Copy, Check, ExternalLink, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { getPublicSiteUrl } from "@/lib/site-url";

const PROVIDER_COUNTRIES = [
  { id: 'fr', name: 'France', dialCode: '+33' },
  { id: 'ma', name: 'Morocco', dialCode: '+212' },
  { id: 'be', name: 'Belgium', dialCode: '+32' },
  { id: 'ch', name: 'Switzerland', dialCode: '+41' },
  { id: 'es', name: 'Spain', dialCode: '+34' },
  { id: 'de', name: 'Germany', dialCode: '+49' },
  { id: 'it', name: 'Italy', dialCode: '+39' },
  { id: 'gb', name: 'United Kingdom', dialCode: '+44' },
  { id: 'us', name: 'United States', dialCode: '+1' },
] as const;

interface UserSettings {
  messaging_provider?: 'whatsapp_cloud' | 'green_api';
  provider_phone_number?: string | null;
  access_token_added: boolean;
  webhook_verified: boolean;
  api_version: string;
  has_access_token: boolean;
  has_phone_number_id: boolean;
  has_business_account_id: boolean;
  has_verify_token: boolean;
  webhook_token: string | null;
  access_token?: string | null;
  phone_number_id?: string | null;
  business_account_id?: string | null;
  verify_token?: string | null;
  green_api_url?: string | null;
  green_media_url?: string | null;
  green_id_instance?: string | null;
  green_api_token_instance?: string | null;
}

export default function SetupPage() {
  // Settings state
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Provider selection
  const [provider, setProvider] = useState<'whatsapp_cloud' | 'green_api'>('whatsapp_cloud');
  const [providerCountryDialCode, setProviderCountryDialCode] = useState<string>('+33'); // default France
  const [providerNationalNumber, setProviderNationalNumber] = useState<string>('');
  const [savingProviderPhone, setSavingProviderPhone] = useState(false);
  const [providerPhoneError, setProviderPhoneError] = useState<string | null>(null);
  const [providerPhoneSuccess, setProviderPhoneSuccess] = useState(false);

  // Access Token form
  const [accessToken, setAccessToken] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [apiVersion, setApiVersion] = useState("v23.0");
  const [savingAccessToken, setSavingAccessToken] = useState(false);
  const [accessTokenError, setAccessTokenError] = useState<string | null>(null);
  const [accessTokenSuccess, setAccessTokenSuccess] = useState(false);

  // Green API form
  const [greenApiUrl, setGreenApiUrl] = useState("");
  const [greenMediaUrl, setGreenMediaUrl] = useState("");
  const [greenIdInstance, setGreenIdInstance] = useState("");
  const [greenApiTokenInstance, setGreenApiTokenInstance] = useState("");
  const [savingGreen, setSavingGreen] = useState(false);
  const [greenError, setGreenError] = useState<string | null>(null);
  const [greenSuccess, setGreenSuccess] = useState(false);
  const [enablingGreenWebhook, setEnablingGreenWebhook] = useState(false);
  const [greenWebhookError, setGreenWebhookError] = useState<string | null>(null);
  const [greenWebhookSuccess, setGreenWebhookSuccess] = useState(false);
  
  // Webhook form
  const [verifyToken, setVerifyToken] = useState("");
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const [webhookSuccess, setWebhookSuccess] = useState(false);
  
  // Copy states
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);
  const [copiedVerifyToken, setCopiedVerifyToken] = useState(false);
  const [copiedAccessToken, setCopiedAccessToken] = useState(false);
  
  // Show/hide states
  const [showAccessToken, setShowAccessToken] = useState(false);

  const [duplicatePhoneModalOpen, setDuplicatePhoneModalOpen] = useState(false);
  
  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/settings/save');
      const data = await response.json();
      
      if (response.ok && data.settings) {
        setSettings(data.settings);

        const p = (data.settings.messaging_provider || 'whatsapp_cloud') as
          | 'whatsapp_cloud'
          | 'green_api';
        setProvider(p);
        
        // Populate form fields if data exists
        if (data.settings.access_token) {
          setAccessToken(data.settings.access_token);
        }
        if (data.settings.phone_number_id) {
          setPhoneNumberId(data.settings.phone_number_id);
        }
        if (data.settings.business_account_id) {
          setBusinessAccountId(data.settings.business_account_id);
        }
        if (data.settings.verify_token) {
          setVerifyToken(data.settings.verify_token);
        }
        setApiVersion(data.settings.api_version || 'v23.0');

        if (data.settings.provider_phone_number) {
          const raw = String(data.settings.provider_phone_number);
          const normalized = raw.trim();
          // Best-effort split into dial code + national number for known countries
          const match = PROVIDER_COUNTRIES.find((c) =>
            normalized.startsWith(c.dialCode),
          );
          if (match) {
            setProviderCountryDialCode(match.dialCode);
            setProviderNationalNumber(
              normalized.slice(match.dialCode.length).replace(/[^\d]/g, ''),
            );
          } else {
            // Fallback: keep default +33 and store digits only in national field
            setProviderNationalNumber(normalized.replace(/[^\d]/g, ''));
          }
        }

        if (data.settings.green_api_url) setGreenApiUrl(data.settings.green_api_url);
        if (data.settings.green_media_url) setGreenMediaUrl(data.settings.green_media_url);
        if (data.settings.green_id_instance) setGreenIdInstance(data.settings.green_id_instance);
        if (data.settings.green_api_token_instance) setGreenApiTokenInstance(data.settings.green_api_token_instance);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Get user and settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);
  
  const handleSaveAccessToken = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAccessToken(true);
    setAccessTokenError(null);
    setAccessTokenSuccess(false);
    
    try {
      if (!accessToken.trim()) {
        setAccessTokenError("Access token is required");
        setSavingAccessToken(false);
        return;
      }
      
      if (!phoneNumberId.trim()) {
        setAccessTokenError("Phone Number ID is required");
        setSavingAccessToken(false);
        return;
      }
      
      if (!businessAccountId.trim()) {
        setAccessTokenError("Business Account ID is required");
        setSavingAccessToken(false);
        return;
      }
      
      const response = await fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_provider: 'whatsapp_cloud',
          access_token: accessToken,
          phone_number_id: phoneNumberId,
          business_account_id: businessAccountId,
          api_version: apiVersion,
        }),
      });
      
      const data = await response.json();

      if (!response.ok) {
        if (
          response.status === 409 &&
          data.error === 'DUPLICATE_PHONE_NUMBER_ID'
        ) {
          setDuplicatePhoneModalOpen(true);
          return;
        }
        throw new Error(
          data.message || data.error || 'Failed to save access token',
        );
      }

      setAccessTokenSuccess(true);
      
      // Reload settings to get updated values
      await loadSettings();
      
      setTimeout(() => setAccessTokenSuccess(false), 3000);
    } catch (error) {
      setAccessTokenError(error instanceof Error ? error.message : 'Failed to save access token');
    } finally {
      setSavingAccessToken(false);
    }
  };

  const handleSaveGreen = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingGreen(true);
    setGreenError(null);
    setGreenSuccess(false);

    try {
      if (!greenApiUrl.trim()) {
        setGreenError("apiUrl is required");
        return;
      }
      if (!greenIdInstance.trim()) {
        setGreenError("idInstance is required");
        return;
      }
      if (!greenApiTokenInstance.trim()) {
        setGreenError("apiTokenInstance is required");
        return;
      }

      const response = await fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_provider: 'green_api',
          green_api_url: greenApiUrl,
          green_media_url: greenMediaUrl,
          green_id_instance: greenIdInstance,
          green_api_token_instance: greenApiTokenInstance,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to save Green API settings');
      }

      setGreenSuccess(true);
      await loadSettings();
      setTimeout(() => setGreenSuccess(false), 3000);
    } catch (error) {
      setGreenError(error instanceof Error ? error.message : 'Failed to save Green API settings');
    } finally {
      setSavingGreen(false);
    }
  };

  const handleSaveProviderPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProviderPhone(true);
    setProviderPhoneError(null);
    setProviderPhoneSuccess(false);

    try {
      const dial = providerCountryDialCode.trim();
      const national = providerNationalNumber.trim().replace(/[^\d]/g, '');
      if (!national) {
        setProviderPhoneError("Phone number is required");
        return;
      }

      const e164 = `${dial}${national}`.replace(/\s+/g, '');
      const response = await fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_phone_number: e164,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to save phone number');
      }

      setProviderPhoneSuccess(true);
      await loadSettings();
      setTimeout(() => setProviderPhoneSuccess(false), 3000);
    } catch (error) {
      setProviderPhoneError(error instanceof Error ? error.message : 'Failed to save phone number');
    } finally {
      setSavingProviderPhone(false);
    }
  };
  
  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingWebhook(true);
    setWebhookError(null);
    setWebhookSuccess(false);
    
    try {
      if (!verifyToken.trim()) {
        setWebhookError("Verify token is required");
        setSavingWebhook(false);
        return;
      }
      
      const response = await fetch('/api/settings/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verify_token: verifyToken,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save webhook configuration');
      }
      
      setWebhookSuccess(true);
      
      // Reload settings
      await loadSettings();
      
      setTimeout(() => setWebhookSuccess(false), 3000);
    } catch (error) {
      setWebhookError(error instanceof Error ? error.message : 'Failed to save webhook configuration');
    } finally {
      setSavingWebhook(false);
    }
  };
  
  const copyToClipboard = (text: string, type: 'webhook' | 'verify' | 'access') => {
    navigator.clipboard.writeText(text);
    if (type === 'webhook') {
      setCopiedWebhookUrl(true);
      setTimeout(() => setCopiedWebhookUrl(false), 2000);
    } else if (type === 'verify') {
      setCopiedVerifyToken(true);
      setTimeout(() => setCopiedVerifyToken(false), 2000);
    } else {
      setCopiedAccessToken(true);
      setTimeout(() => setCopiedAccessToken(false), 2000);
    }
  };
  
  // Mask access token - show first 10 chars and rest as asterisks
  const getMaskedAccessToken = (token: string) => {
    if (!token || token.length <= 10) return token;
    const visiblePart = token.substring(0, 10);
    const maskedPart = '*'.repeat(Math.min(token.length - 10, 50)); // Cap asterisks at 50
    return visiblePart + maskedPart;
  };
  
  const webhookUrl = typeof window !== 'undefined' && settings?.webhook_token
    ? `${window.location.origin}/api/webhook/${settings.webhook_token}`
    : '';

  const greenWebhookUrl =
    typeof window !== 'undefined' && settings?.webhook_token
      ? `${window.location.origin}/api/green/webhook/${settings.webhook_token}`
      : '';
  
  const greenReady = !!(
    settings?.green_api_url &&
    settings?.green_id_instance &&
    settings?.green_api_token_instance
  );
  const whatsappReady = !!(settings?.access_token_added || settings?.webhook_verified);
  const hasCommonPhone = !!settings?.provider_phone_number;
  const isSetupComplete =
    (settings?.messaging_provider || 'whatsapp_cloud') === 'green_api'
      ? greenReady && hasCommonPhone
      : whatsappReady && hasCommonPhone;
  
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
          <p className="text-muted-foreground">Loading settings...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-background via-background to-muted/20">
      {duplicatePhoneModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-phone-title"
          onClick={() => setDuplicatePhoneModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <AlertCircle className="h-6 w-6 shrink-0 text-amber-600" />
              <div>
                <h2
                  id="duplicate-phone-title"
                  className="text-lg font-semibold"
                >
                  Phone Number ID already in use
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This Phone Number ID is already linked to another WaChat account.
                  Each Meta phone number can only be linked to one account. Use a
                  different account or the Phone Number ID that belongs to this Meta
                  app only.
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => setDuplicatePhoneModalOpen(false)}
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="container max-w-6xl mx-auto py-8 px-4 pb-16">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-green-600 to-emerald-600 bg-clip-text text-transparent">
            WhatsApp Setup
          </h1>
          <p className="text-muted-foreground text-lg">
            Configure your WhatsApp Business API credentials to start sending and receiving messages
          </p>
        </div>
        
        {/* Setup Status Banner */}
        {isSetupComplete && (
          <Card className="mb-6 border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-900">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                <div className="flex-1">
                  <p className="font-semibold text-green-900 dark:text-green-100">
                    Setup Complete!
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    You can now access the chat interface
                  </p>
                </div>
                <Link href="/protected">
                  <Button className="bg-green-600 hover:bg-green-700">
                    Go to Chat
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Instruction Banner */}
        {!isSetupComplete && (
          <Card className="mb-6 border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-6 w-6 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <p className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    Complete at least one setup to continue
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Configure either the Access Token (for sending messages) or Webhook (for receiving messages) to unlock the chat interface
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
        
        <div className="mb-6">
          <Card className="shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl">Messaging Provider</CardTitle>
              <CardDescription>
                Choose how this account connects to WhatsApp. Your chats will use the selected provider.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                <form onSubmit={handleSaveProviderPhone} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="provider-phone-number">Business Phone Number (common) *</Label>
                    <div className="flex gap-2">
                      <select
                        aria-label="Country"
                        value={providerCountryDialCode}
                        onChange={(e) => setProviderCountryDialCode(e.target.value)}
                        className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {PROVIDER_COUNTRIES.map((c) => (
                          <option key={c.id} value={c.dialCode}>
                            {c.name} ({c.dialCode})
                          </option>
                        ))}
                      </select>
                      <Input
                        id="provider-phone-number"
                        type="tel"
                        placeholder="600000000"
                        value={providerNationalNumber}
                        onChange={(e) => setProviderNationalNumber(e.target.value)}
                        className="font-mono text-sm"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      This number is shared between WhatsApp Cloud API and Green API. It will be saved as{' '}
                      <span className="font-mono">
                        {providerCountryDialCode}
                        {providerNationalNumber.replace(/[^\d]/g, '') || '…'}
                      </span>
                      .
                    </p>
                  </div>
                  {providerPhoneError && (
                    <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg flex items-start gap-2">
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <span>{providerPhoneError}</span>
                    </div>
                  )}
                  {providerPhoneSuccess && (
                    <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/20 p-3 rounded-lg flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Phone number saved!</span>
                    </div>
                  )}
                  <Button type="submit" variant="outline" disabled={savingProviderPhone}>
                    {savingProviderPhone ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Phone Number'
                    )}
                  </Button>
                </form>

                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="provider"
                    className="mt-1"
                    checked={provider === 'whatsapp_cloud'}
                    onChange={() => setProvider('whatsapp_cloud')}
                  />
                  <div>
                    <div className="font-medium">WhatsApp Cloud API (Meta)</div>
                    <div className="text-sm text-muted-foreground">
                      Uses Meta Graph API + webhook for inbound messages.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="provider"
                    className="mt-1"
                    checked={provider === 'green_api'}
                    onChange={() => setProvider('green_api')}
                  />
                  <div>
                    <div className="font-medium">Green API</div>
                    <div className="text-sm text-muted-foreground">
                      Uses Green API instance credentials for sending messages.
                    </div>
                  </div>
                </label>
                <div className="pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await fetch('/api/settings/save', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ messaging_provider: provider }),
                        });
                        await loadSettings();
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                  >
                    Save Provider Selection
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Access Token Configuration */}
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    Access Token
                    {settings?.access_token_added && (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Required for sending WhatsApp messages
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveAccessToken} className="space-y-4">
                {provider !== 'whatsapp_cloud' && (
                  <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      WhatsApp Cloud API is not the selected provider. You can still save these credentials, but sending will use {provider === 'green_api' ? 'Green API' : 'the selected provider'}.
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="access-token">Access Token *</Label>
                    {settings?.has_access_token && (
                      <Badge variant="secondary" className="text-xs">
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="relative flex items-center gap-2">
                    <Input
                      id="access-token"
                      type="text"
                      placeholder="Enter your WhatsApp Access Token"
                      value={accessToken && !showAccessToken ? getMaskedAccessToken(accessToken) : accessToken}
                      onChange={(e) => {
                        // Only allow editing if shown or if it's empty/being typed for first time
                        if (showAccessToken || !settings?.access_token_added) {
                          setAccessToken(e.target.value);
                        }
                      }}
                      // readOnly={!showAccessToken && settings?.access_token_added}
                      className="font-mono text-sm pr-20"
                    />
                    {accessToken && (
                      <div className="absolute right-2 flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setShowAccessToken(!showAccessToken)}
                          title={showAccessToken ? "Hide token" : "Show token"}
                        >
                          {showAccessToken ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => copyToClipboard(accessToken, 'access')}
                          title="Copy token"
                        >
                          {copiedAccessToken ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get this from your Meta Business Suite
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="phone-number-id">Phone Number ID *</Label>
                    {settings?.has_phone_number_id && (
                      <Badge variant="secondary" className="text-xs">
                        Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="phone-number-id"
                    type="text"
                    placeholder="Enter your Phone Number ID"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    className="font-mono text-sm"
                    // readOnly={settings?.access_token_added}
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in WhatsApp Business API settings
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="business-account-id">Business Account ID *</Label>
                    {settings?.has_business_account_id && (
                      <Badge variant="secondary" className="text-xs">
                        Configured
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="business-account-id"
                    type="text"
                    placeholder="Enter your WhatsApp Business Account ID"
                    value={businessAccountId}
                    onChange={(e) => setBusinessAccountId(e.target.value)}
                    className="font-mono text-sm"
                    // readOnly={settings?.access_token_added}
                  />
                  <p className="text-xs text-muted-foreground">
                    Found in Meta Business Suite settings
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="api-version">API Version</Label>
                  <Input
                    id="api-version"
                    type="text"
                    placeholder="v23.0"
                    value={apiVersion}
                    onChange={(e) => setApiVersion(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Default: v23.0 (recommended)
                  </p>
                </div>
                
                {accessTokenError && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{accessTokenError}</span>
                  </div>
                )}
                
                {accessTokenSuccess && (
                  <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/20 p-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Access token saved successfully!</span>
                  </div>
                )}
                
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={savingAccessToken}
                >
                  {savingAccessToken ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Access Token'
                  )}
                </Button>
                
                {settings?.access_token_added && (
                  <p className="text-sm text-center text-muted-foreground">
                    ✓ Access token configured
                  </p>
                )}
              </form>
            </CardContent>
          </Card>

          {/* Green API Configuration */}
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    Green API
                    {greenReady && (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Required for sending WhatsApp messages via Green API
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveGreen} className="space-y-4">
                {provider !== 'green_api' && (
                  <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/20 p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>
                      Green API is not the selected provider. You can still save these credentials, but sending will use {provider === 'whatsapp_cloud' ? 'WhatsApp Cloud API' : 'the selected provider'}.
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="green-api-url">apiUrl *</Label>
                  <Input
                    id="green-api-url"
                    type="text"
                    placeholder="https://7107.api.greenapi.com"
                    value={greenApiUrl}
                    onChange={(e) => setGreenApiUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="green-media-url">mediaUrl</Label>
                  <Input
                    id="green-media-url"
                    type="text"
                    placeholder="https://7107.api.greenapi.com"
                    value={greenMediaUrl}
                    onChange={(e) => setGreenMediaUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="green-id-instance">idInstance *</Label>
                  <Input
                    id="green-id-instance"
                    type="text"
                    placeholder="7107587161"
                    value={greenIdInstance}
                    onChange={(e) => setGreenIdInstance(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="green-token-instance">apiTokenInstance *</Label>
                  <Input
                    id="green-token-instance"
                    type="text"
                    placeholder="Your apiTokenInstance"
                    value={greenApiTokenInstance}
                    onChange={(e) => setGreenApiTokenInstance(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>

                {greenError && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{greenError}</span>
                  </div>
                )}

                {greenSuccess && (
                  <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/20 p-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Green API settings saved successfully!</span>
                  </div>
                )}

                <Button type="submit" className="w-full" disabled={savingGreen}>
                  {savingGreen ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Green API Settings'
                  )}
                </Button>
              </form>

              <div className="mt-6 space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <Label>Green API Webhook URL (receive messages)</Label>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={greenWebhookUrl || 'Loading webhook url...'}
                      readOnly
                      className="font-mono text-sm bg-muted"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(greenWebhookUrl, 'webhook')}
                      disabled={!greenWebhookUrl}
                      title="Copy webhook url"
                    >
                      {copiedWebhookUrl ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    To receive messages via Green API, your app must be publicly accessible. Set{' '}
                    <span className="font-mono">NEXT_PUBLIC_SITE_URL</span> to your domain in production.
                  </p>
                </div>

                {greenWebhookError && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{greenWebhookError}</span>
                  </div>
                )}
                {greenWebhookSuccess && (
                  <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/20 p-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Green API webhook enabled! Incoming messages will appear here.</span>
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full"
                  disabled={enablingGreenWebhook}
                  onClick={async () => {
                    setEnablingGreenWebhook(true);
                    setGreenWebhookError(null);
                    setGreenWebhookSuccess(false);
                    try {
                      // Quick client-side hint for local dev
                      const base = getPublicSiteUrl();
                      if (!base) {
                        throw new Error('NEXT_PUBLIC_SITE_URL is not set. Set it to your public domain to enable webhooks.');
                      }
                      const resp = await fetch('/api/green/enable-webhook', { method: 'POST' });
                      const data = await resp.json();
                      if (!resp.ok) throw new Error(data.error || 'Failed to enable webhook');
                      setGreenWebhookSuccess(true);
                      setTimeout(() => setGreenWebhookSuccess(false), 3000);
                    } catch (e) {
                      setGreenWebhookError(e instanceof Error ? e.message : 'Failed to enable webhook');
                    } finally {
                      setEnablingGreenWebhook(false);
                    }
                  }}
                >
                  {enablingGreenWebhook ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Enabling...
                    </>
                  ) : (
                    'Enable Green API Webhook'
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
          
          {/* Webhook Configuration */}
          <Card className="shadow-lg">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-2xl flex items-center gap-2">
                    Webhook Setup
                    {settings?.webhook_verified && (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    )}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    Required for receiving WhatsApp messages
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveWebhook} className="space-y-4">
                {/* Webhook URL */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label>Webhook URL</Label>
                    <Badge variant="secondary" className="text-xs">
                      Unique to You
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={webhookUrl || 'Loading your unique webhook URL...'}
                      readOnly
                      className="font-mono text-sm bg-muted"
                      placeholder="Your unique webhook URL will appear here"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => copyToClipboard(webhookUrl, 'webhook')}
                      disabled={!webhookUrl}
                    >
                      {copiedWebhookUrl ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {webhookUrl ? (
                      "This is your unique webhook URL. Copy it to your Meta webhook configuration"
                    ) : (
                      "Your unique webhook URL is being generated..."
                    )}
                  </p>
                </div>
                
                {/* Verify Token */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="verify-token">Verify Token *</Label>
                    {settings?.has_verify_token && (
                      <Badge variant="secondary" className="text-xs">
                        Configured
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="verify-token"
                      type="text"
                      placeholder="Enter a secure verify token"
                      value={verifyToken}
                      onChange={(e) => setVerifyToken(e.target.value)}
                      className="font-mono text-sm"
                      // readOnly={settings?.webhook_verified}
                    />
                    {verifyToken && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(verifyToken, 'verify')}
                      >
                        {copiedVerifyToken ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Create a secure token (e.g., random string). You&apos;ll need this when configuring the webhook in Meta
                  </p>
                </div>
                
                {/* Instructions */}
                <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                  <p className="font-semibold">Setup Instructions:</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Create a secure verify token above</li>
                    <li>Click &quot;Save Webhook Configuration&quot;</li>
                    <li>Go to Meta Business Suite</li>
                    <li>Add the webhook URL and verify token</li>
                    <li>Subscribe to message events</li>
                  </ol>
                </div>
                
                {webhookError && (
                  <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/20 p-3 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{webhookError}</span>
                  </div>
                )}
                
                {webhookSuccess && (
                  <div className="text-sm text-green-600 bg-green-50 dark:bg-green-950/20 p-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Webhook configuration saved! Now verify it in Meta Business Suite</span>
                  </div>
                )}
                
                <Button 
                  type="submit" 
                  className="w-full"
                  disabled={savingWebhook}
                >
                  {savingWebhook ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Webhook Configuration'
                  )}
                </Button>
                
                {settings?.has_verify_token && !settings?.webhook_verified && (
                  <p className="text-sm text-center text-amber-600">
                    ⚠ Webhook configured but not yet verified by Meta
                  </p>
                )}
                
                {settings?.webhook_verified && (
                  <p className="text-sm text-center text-muted-foreground">
                    ✓ Webhook verified and active
                  </p>
                )}
              </form>
            </CardContent>
          </Card>
        </div>
        
        {/* Help Section */}
        <Card className="mt-6 border-dashed">
          <CardHeader>
            <CardTitle className="text-lg">Need Help?</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              • <strong>Access Token:</strong> Found in your Meta Business Suite under WhatsApp API settings
            </p>
            <p>
              • <strong>Phone Number ID:</strong> The unique identifier for your WhatsApp Business phone number
            </p>
            <p>
              • <strong>Business Account ID:</strong> Your WhatsApp Business Account ID from Meta Business Suite (used for managing templates)
            </p>
            <p>
              • <strong>Webhook URL:</strong> Each user gets a unique webhook URL with a secure token for enhanced security and multi-tenant support
            </p>
            <p>
              • <strong>Verify Token:</strong> A security token you create to verify webhook requests from Meta (choose a strong, random string)
            </p>
            <p className="pt-2 border-t border-border">
              <strong>Note:</strong> Your unique webhook URL is automatically generated when you first visit this page. Use this URL in your Meta Business Suite webhook configuration.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

