import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as AdmZip from 'adm-zip';

// ---------------------------------------------------------------------------
// SECURITY CONSTRAINTS (aplicate strict):
//   ❌ Token OAuth ANAF nu se stochează în DB — doar în memoria procesului
//   ❌ CUI/credențiale nu se loghează — doar ID-uri de operație
//   ❌ Certificatul digital nu se stochează în DB — cale pe FS din env
// ---------------------------------------------------------------------------

interface AnafToken {
  accessToken: string;
  expiresAt:   number;  // Date.now() + expires_in * 1000
}

export interface AnafUploadResult {
  executionStatus: number;   // 0 = succes
  uploadIndex:     string;   // număr de înregistrare
  errorMessage?:   string;
}

export interface AnafStatusResult {
  stare:        string;      // 'ok' | 'nok' | 'in prelucrare' | 'eroare xml'
  downloadId?:  string;      // id_descarcare — prezent când stare in ['ok','nok']
  message?:     string;
}

export interface AnafDownloadResult {
  responseXml:  string;      // XML din ZIP dezarhivat
  rawZipBase64: string;      // ZIP original ca base64 (pentru audit)
}

@Injectable()
export class AnafApiClient {
  private readonly logger = new Logger(AnafApiClient.name);

  // Token cache în memorie — NICIODATĂ în DB sau loguri
  private tokenCache: AnafToken | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // OAuth Token — cu cache în memorie
  // Credențialele vin EXCLUSIV din variabile de mediu:
  //   ANAF_CLIENT_ID, ANAF_CLIENT_SECRET, ANAF_TOKEN_URL
  //   ANAF_CERT_PATH (cale către certificatul digital calificat .p12)
  //   ANAF_CERT_PASSWORD (parola certificat)
  // ---------------------------------------------------------------------------

  async getAccessToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl    = this.config.get<string>('ANAF_TOKEN_URL',
      'https://logincert.anaf.ro/anaf-oauth2/v1/token');
    const clientId    = this.config.get<string>('ANAF_CLIENT_ID');
    const clientSecret = this.config.get<string>('ANAF_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error(
        'ANAF OAuth credentials missing. Set ANAF_CLIENT_ID and ANAF_CLIENT_SECRET in environment.',
      );
    }

    // Token request cu client_credentials grant
    // Certificatul digital este configurat la nivel de agent HTTPS (mTLS)
    // prin ANAF_CERT_PATH + ANAF_CERT_PASSWORD — se injectează în HttpService
    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'upload:invoice',
      token_content_type: 'jwt',
    });

    const response = await firstValueFrom(
      this.http.post<{ access_token: string; expires_in: number }>(
        tokenUrl,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    this.tokenCache = {
      accessToken: response.data.access_token,
      expiresAt:   Date.now() + (response.data.expires_in ?? 600) * 1000,
    };

    // SECURITY: nu logăm tokenul
    this.logger.log(`ANAF token refreshed, expires in ${response.data.expires_in}s`);
    return this.tokenCache.accessToken;
  }

  // ---------------------------------------------------------------------------
  // Upload XML la ANAF
  // Endpoint: POST /FCTEL/rest/upload?standard=UBL&cif=<CIF_FURNIZOR>
  // ---------------------------------------------------------------------------

  async uploadInvoice(xmlContent: string, supplierCif: string): Promise<AnafUploadResult> {
    const baseUrl = this.config.get<string>('ANAF_API_BASE_URL',
      'https://api.anaf.ro/prod/FCTEL/rest');
    const token   = await this.getAccessToken();

    // SECURITY: nu logăm xmlContent (conține date financiare)
    this.logger.log(`Uploading invoice to ANAF for CIF:${supplierCif.slice(0, 2)}***`);

    const response = await firstValueFrom(
      this.http.post<{ ExecutionStatus: number; index_incarcare?: number; Errors?: Array<{ errorMessage: string }> }>(
        `${baseUrl}/upload?standard=UBL&cif=${supplierCif}`,
        Buffer.from(xmlContent, 'utf8'),
        {
          headers: {
            Authorization:  `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
        },
      ),
    );

    const { ExecutionStatus, index_incarcare, Errors } = response.data;
    return {
      executionStatus: ExecutionStatus,
      uploadIndex:     String(index_incarcare ?? ''),
      errorMessage:    Errors?.[0]?.errorMessage,
    };
  }

  // ---------------------------------------------------------------------------
  // Polling status
  // Endpoint: GET /FCTEL/rest/stareMesaj?id_incarcare=<uploadIndex>
  // ---------------------------------------------------------------------------

  async getStatus(uploadIndex: string): Promise<AnafStatusResult> {
    const baseUrl = this.config.get<string>('ANAF_API_BASE_URL',
      'https://api.anaf.ro/prod/FCTEL/rest');
    const token   = await this.getAccessToken();

    const response = await firstValueFrom(
      this.http.get<{ stare: string; id_descarcare?: number; mesaj?: string }>(
        `${baseUrl}/stareMesaj?id_incarcare=${uploadIndex}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

    // SECURITY: nu logăm "mesaj" — poate conține date fiscale
    this.logger.log(`ANAF status for upload:${uploadIndex} → ${response.data.stare}`);

    return {
      stare:      response.data.stare,
      downloadId: response.data.id_descarcare != null
        ? String(response.data.id_descarcare)
        : undefined,
      message:    response.data.mesaj,
    };
  }

  // ---------------------------------------------------------------------------
  // Download răspuns ZIP
  // Endpoint: GET /FCTEL/rest/descarcare?id=<downloadId>
  // Răspuns: ZIP care conține un XML de răspuns ANAF
  // ---------------------------------------------------------------------------

  async downloadResponse(downloadId: string): Promise<AnafDownloadResult> {
    const baseUrl = this.config.get<string>('ANAF_API_BASE_URL',
      'https://api.anaf.ro/prod/FCTEL/rest');
    const token   = await this.getAccessToken();

    const response = await firstValueFrom(
      this.http.get<ArrayBuffer>(
        `${baseUrl}/descarcare?id=${downloadId}`,
        {
          headers:      { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
        },
      ),
    );

    const zipBuffer = Buffer.from(response.data);
    const rawZipBase64 = zipBuffer.toString('base64');

    // Dezarhivare ZIP — extrage primul XML
    const zip = new AdmZip(zipBuffer);
    const xmlEntry = zip.getEntries().find((e) => e.name.endsWith('.xml'));
    if (!xmlEntry) {
      throw new Error(`ANAF response ZIP for download ${downloadId} contains no XML file`);
    }

    const responseXml = xmlEntry.getData().toString('utf8');
    this.logger.log(`ANAF response downloaded for download:${downloadId}`);

    return { responseXml, rawZipBase64 };
  }
}
