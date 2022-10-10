/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { Connection, Messages, SfError, sfdc, Logger } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { Optional } from '@salesforce/ts-types';
import {
  PackageInstallCreateRequest,
  PackageInstallOptions,
  PackageType,
  PackagingSObjects,
  SubscriberPackageVersionOptions,
} from '../interfaces';
import {
  applyErrorAction,
  escapeInstallationKey,
  massageErrorMessage,
  numberToDuration,
  VersionNumber,
} from '../utils';
import { createPackageInstallRequest, getStatus, pollStatus, waitForPublish } from './packageInstall';
import { getUninstallErrors, uninstallPackage } from './packageUninstall';

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'subscriber_package_version');

type SPV = PackagingSObjects.SubscriberPackageVersion;
// these fields have been identified as requiring additional serverside resources in order to calculate their values
// and are therefore not returned by default
// these will require additional queries to retrieve
const highCostQueryFields = [
  'AppExchangeDescription',
  'AppExchangeLogoUrl',
  'AppExchangePackageName',
  'AppExchangePublisherName',
  'CspTrustedSite',
  'Dependencies',
  'PostInstallUrl',
  'ReleaseNotesUrl',
  'RemoteSiteSettings',
  //  'InstallValidationStatus', // This requires extra resources on the server, but is commonly used, so let it load as part of the default query
  'Profiles',
];

export const SubscriberPackageVersionFields = [
  'AppExchangeDescription',
  'AppExchangeLogoUrl',
  'AppExchangePackageName',
  'AppExchangePublisherName',
  'BuildNumber',
  'CspTrustedSites',
  'Dependencies',
  'Description',
  'Id',
  'InstallValidationStatus',
  'IsBeta',
  'IsDeprecated',
  'IsManaged',
  'IsOrgDependent',
  'IsPasswordProtected',
  'IsSecurityReviewed',
  'MajorVersion',
  'MinorVersion',
  'Name',
  'Package2ContainerOptions',
  'PatchVersion',
  'PostInstallUrl',
  'Profiles',
  'PublisherName',
  'ReleaseNotesUrl',
  'ReleaseState',
  'RemoteSiteSettings',
  'SubscriberPackageId',
];

let logger: Logger;
const getLogger = (): Logger => {
  if (!logger) {
    logger = Logger.childFromRoot('subscriberPackageVersion');
  }
  return logger;
};

const allZeroesInstallOptions: PackageInstallOptions = {
  pollingFrequency: Duration.minutes(0),
  pollingTimeout: Duration.minutes(0),
  publishFrequency: Duration.minutes(0),
  publishTimeout: Duration.minutes(0),
};

export class SubscriberPackageVersion {
  // fields from the SubscriberPackageVersion object
  // public Id: string;
  // public SubscriberPackageId: string;
  // public Name: string;
  // public Description: string;
  // public PublisherName: string;
  // public MajorVersion: number;
  // public MinorVersion: number;
  // public PatchVersion: number;
  // public BuildNumber: number;
  // public ReleaseState: string;
  // public IsManaged: boolean;
  // public IsDeprecated: boolean;
  // public IsPasswordProtected: boolean;
  // public IsBeta: boolean;
  // public Package2ContainerOptions: PackageType;
  // public IsSecurityReviewed: boolean;
  // public IsOrgDependent: boolean;
  // public AppExchangePackageName: string;
  // public AppExchangeDescription: string;
  // public AppExchangePublisherName: string;
  // public AppExchangeLogoUrl: string;
  // public ReleaseNotesUrl: string;
  // public PostInstallUrl: string;
  // public RemoteSiteSettings: PackagingSObjects.SubscriberPackageRemoteSiteSettings;
  // public CspTrustedSites: PackagingSObjects.SubscriberPackageCspTrustedSites;
  // public Profiles: PackagingSObjects.SubscriberPackageProfiles;
  // public Dependencies: PackagingSObjects.SubscriberPackageDependencies;
  // public InstallValidationStatus: PackagingSObjects.InstallValidationStatus;
  // end of fields from the SubscriberPackageVersion object
  private readonly password: Optional<string>;
  private readonly connection: Connection;
  private data: PackagingSObjects.SubscriberPackageVersion;
  private fieldsRead = new Set<string>();

  public constructor(private options: SubscriberPackageVersionOptions) {
    this.connection = this.options.connection;

    // validate ID
    if (!this.options.id.startsWith('04t') || !sfdc.validateSalesforceId(this.options.id)) {
      throw messages.createError('errorInvalidPackageVersionId', [this.options.id]);
    }
    this.password = this.options.password;
  }
  /**
   * Fetches the status of a package version install request and will wait for the install to complete, if requested
   * Package Version install emits the following events:
   * - PackageEvents.install['subscriber-status']
   *
   * @param connection
   * @param packageInstallRequestOrId
   * @param installationKey
   * @param options
   */
  public static async installStatus(
    connection: Connection,
    packageInstallRequestOrId: string | PackagingSObjects.PackageInstallRequest,
    installationKey?: string,
    options?: PackageInstallOptions
  ): Promise<PackagingSObjects.PackageInstallRequest> {
    const id = typeof packageInstallRequestOrId === 'string' ? packageInstallRequestOrId : packageInstallRequestOrId.Id;
    const packageInstallRequest = await getStatus(connection, id);
    const pollingTimeout = numberToDuration(options.pollingTimeout) ?? Duration.milliseconds(0);
    if (pollingTimeout.milliseconds <= 0) {
      return packageInstallRequest;
    } else {
      await waitForPublish(
        connection,
        packageInstallRequest.SubscriberPackageVersionKey,
        options?.publishFrequency || 0,
        options?.publishTimeout || 0,
        installationKey
      );
      return pollStatus(connection, id, options);
    }
  }

  /**
   * Reports on the progress of a package version uninstall.
   *
   * @param id the 06y package version uninstall request id
   * @param connection
   */
  public static async uninstallStatus(
    id: string,
    connection: Connection
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    if (!id.startsWith('06y') || !sfdc.validateSalesforceId(id)) {
      throw messages.createError('packageVersionUninstallRequestIdInvalid', [id]);
    }
    const result = (await connection.tooling.retrieve(
      'SubscriberPackageVersionUninstallRequest',
      id
    )) as PackagingSObjects.SubscriberPackageVersionUninstallRequest;
    if (result.Status === 'Error') {
      const errorDetails = await getUninstallErrors(connection, id);
      const errors = errorDetails.map((record, index) => `(${index + 1}) ${record.Message}`);
      const errHeader = errors.length > 0 ? `\n=== Errors\n${errors.join('\n')}` : '';
      const err = messages.getMessage('defaultErrorMessage', [id, result.Id]);

      throw new SfError(`${err}${errHeader}`, 'UNINSTALL_ERROR', [messages.getMessage('action')]);
    }
    return result;
  }
  /**
   * Retrieves the package version create request.
   *
   * @param installRequestId
   * @param connection
   */
  public static async getInstallRequest(
    installRequestId: string,
    connection: Connection
  ): Promise<PackagingSObjects.PackageInstallRequest> {
    if (!installRequestId.startsWith('0Hf') || !sfdc.validateSalesforceId(installRequestId)) {
      throw messages.createError('packageVersionInstallRequestIdInvalid', [installRequestId]);
    }
    const installRequest = await getStatus(connection, installRequestId);
    if (!installRequest) {
      throw messages.createError('packageVersionInstallRequestNotFound', [installRequestId]);
    }
    return installRequest;
  }

  /**
   * Get the package version ID for this SubscriberPackageVersion.
   *
   * @returns The PackageVersionId (05i).
   */
  public getId(): Promise<string> {
    return Promise.resolve(this.options.id);
  }

  /**
   * Get the package type for this SubscriberPackageVersion.
   *
   * @returns {PackageType} The package type.
   */
  public async getPackageType(): Promise<PackageType> {
    return this.getField<SPV['Package2ContainerOptions']>('Package2ContainerOptions');
  }

  /**
   * Get the password passed in the constructor
   *
   * @returns {string} the password
   */
  public getPassword(): Optional<string> {
    return this.password;
  }

  /**
   * Get the subscriber package Id (033) for this SubscriberPackageVersion.
   *
   * @returns {string} The subscriber package Id.
   */
  public async getSubscriberPackageId(): Promise<string> {
    return this.getField<SPV['SubscriberPackageId']>('SubscriberPackageId');
  }

  /**
   * Get a VersionNumber instance for this SubscriberPackageVersion.
   *
   * @returns {VersionNumber} The version number.
   */
  public async getVersionNumber(): Promise<VersionNumber> {
    const majorVersion = await this.getField<SPV['MajorVersion']>('MajorVersion');
    const minorVersion = await this.getField<SPV['MinorVersion']>('MinorVersion');
    const patchVersion = await this.getField<SPV['PatchVersion']>('PatchVersion');
    const buildNumber = await this.getField<SPV['BuildNumber']>('BuildNumber');
    return new VersionNumber(majorVersion, minorVersion, patchVersion, buildNumber);
  }

  /**
   * Is the package a managed package?
   */
  public async isManaged(): Promise<boolean> {
    return this.getField<SPV['IsManaged']>('IsManaged');
  }

  /**
   * Is the SubscriberPackageVersion deprecated?
   *
   * @returns {boolean} True if the SubscriberPackageVersion is deprecated.
   */
  public async isDeprecated(): Promise<boolean> {
    return this.getField<SPV['IsDeprecated']>('IsDeprecated');
  }

  /**
   * Is the SubscriberPackageVersion password protected?
   *
   * @returns {boolean} True if the SubscriberPackageVersion is password protected.
   */
  public async isPasswordProtected(): Promise<boolean> {
    return this.getField<SPV['IsPasswordProtected']>('IsPasswordProtected');
  }

  /**
   * Is the SubscriberPackageVersion org dependent?
   *
   * @returns {boolean} True if the SubscriberPackageVersion is org dependent.
   */
  public async isOrgDependent(): Promise<boolean> {
    return this.getField<SPV['IsOrgDependent']>('IsOrgDependent');
  }

  /**
   * Return remote site settings for the SubscriberPackageVersion.
   *
   * @returns {RemoteSiteSettings} The remote site settings.
   */
  public async getRemoteSiteSettings(): Promise<PackagingSObjects.SubscriberPackageRemoteSiteSettings> {
    return this.getField<SPV['RemoteSiteSettings']>('RemoteSiteSettings');
  }

  /**
   * Return CSP trusted sites for the SubscriberPackageVersion.
   *
   * @returns {CspTrustedSites} The CSP trusted sites.
   */
  public async getCspTrustedSites(): Promise<PackagingSObjects.SubscriberPackageCspTrustedSites> {
    return this.getField<SPV['CspTrustedSites']>('CspTrustedSites');
  }

  /**
   * Get the installation validation status for the SubscriberPackageVersion.
   *
   * @returns {InstallationValidationStatus} The installation validation status.
   */
  public async getInstallValidationStatus(): Promise<PackagingSObjects.InstallValidationStatus> {
    return this.getField<SPV['InstallValidationStatus']>('InstallValidationStatus');
  }

  /**
   * Get the SubscriberPackageVersion SObject data for this SubscriberPackageVersion.
   *
   * @param force - force a refresh of the subscriber package version data.
   * @returns {PackagingSObjects.SubscriberPackageVersion} SObject data.
   */
  public async getData(
    options: { force?: boolean; includeHighCostFields?: boolean } = { force: false, includeHighCostFields: false }
  ): Promise<PackagingSObjects.SubscriberPackageVersion> {
    if (!this.data || options.force || options.includeHighCostFields) {
      const queryFields = this.getFieldsForQuery(options);
      if (queryFields.length === 0) {
        return this.data;
      }
      try {
        const queryNoKey = `SELECT ${queryFields.toString()} FROM SubscriberPackageVersion WHERE Id ='${await this.getId()}'`;
        const escapedInstallationKey = this.password ? escapeInstallationKey(this.password) : null;
        const queryWithKey = `${queryNoKey} AND InstallationKey ='${escapedInstallationKey}'`;
        this.data = await this.connection.singleRecordQuery<PackagingSObjects.SubscriberPackageVersion>(queryWithKey, {
          tooling: true,
        });
      } catch (err) {
        throw messages.createError('errorInvalidIdNoRecordFound', [this.options.id], undefined, err as Error);
      }

      // map the fields returned from the query to the class properties
      this.mapFields(queryFields);
    }
    return this.data;
  }

  /**
   * Installs a package version in a subscriber org.
   *
   * Package Version install emits the following events:
   * - PackageEvents.install.warning
   * - PackageEvents.install.presend
   * - PackageEvents.install.postsend
   * - PackageEvents.install['subscriber-status']
   *
   * @param pkgInstallCreateRequest
   * @param options
   */
  public async install(
    pkgInstallCreateRequest: PackageInstallCreateRequest,
    options: PackageInstallOptions = allZeroesInstallOptions
  ): Promise<PackagingSObjects.PackageInstallRequest> {
    try {
      // before starting the install, check to see if the package version is available for install
      await waitForPublish(
        this.connection,
        await this.getId(),
        options.publishFrequency,
        options.publishTimeout,
        pkgInstallCreateRequest.Password
      );
      const pkgVersionInstallRequest = await createPackageInstallRequest(
        this.connection,
        pkgInstallCreateRequest,
        await this.getPackageType()
      );
      return SubscriberPackageVersion.installStatus(
        this.connection,
        pkgVersionInstallRequest.Id,
        pkgInstallCreateRequest.Password,
        options
      );
    } catch (e) {
      throw applyErrorAction(massageErrorMessage(e as Error));
    }
  }

  /**
   * Uninstalls a package version from a subscriber org.
   *
   * @param frequency
   * @param wait
   */
  public async uninstall(
    frequency: Duration = Duration.milliseconds(0),
    wait: Duration = Duration.milliseconds(0)
  ): Promise<PackagingSObjects.SubscriberPackageVersionUninstallRequest> {
    return await uninstallPackage(await this.getId(), this.connection, frequency, wait);
  }

  /**
   * Returns an array of RSS and CSP external sites for the package.
   *
   * @param installationKey The installation key (if any) for the subscriber package version.
   * @returns an array of RSS and CSP site URLs, or undefined if the package doesn't have any.
   */
  public async getExternalSites(): Promise<Optional<string[]>> {
    getLogger().debug(`Checking package: [${await this.getId()}] for external sites`);

    const remoteSiteSettings = await this.getRemoteSiteSettings();
    const cspTrustedSites = await this.getCspTrustedSites();

    const rssUrls = remoteSiteSettings?.settings ? remoteSiteSettings.settings?.map((rss) => rss.url) : [];
    const cspUrls = cspTrustedSites?.settings ? cspTrustedSites?.settings.map((csp) => csp.endpointUrl) : [];

    const sites = [...rssUrls, ...cspUrls];
    return sites.length > 0 ? sites : undefined;
  }

  /**
   * Return a field value from the SubscriberPackageVersion SObject using the field name.
   *
   * @param field
   */
  public async getField<T>(field: string): Promise<T> {
    if (!this.data || !Reflect.has(this.data, field)) {
      await this.getData({ includeHighCostFields: highCostQueryFields.includes(field) });
    }
    return Reflect.get(this.data, field);
  }

  private getFieldsForQuery(options: { force?: boolean; includeHighCostFields?: boolean }): string[] {
    const queryFields = SubscriberPackageVersionFields.filter(
      (field) => !highCostQueryFields.includes(field) || options.includeHighCostFields
    ).filter((field) => (!this.fieldsRead.has(field) && !options.force) || options.force);
    return queryFields;
  }

  private mapFields(fields: string[]): void {
    fields.forEach((field) => {
      Reflect.set(this, field, Reflect.get(this.data, field));
      this.fieldsRead.add(field);
    });
  }
}
