/*
 * Copyright (c) 2022, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { Messages, sfdc } from '@salesforce/core';
import { AsyncCreatable, Duration } from '@salesforce/kit';
import { QueryResult } from 'jsforce';
import { Optional } from '@salesforce/ts-types';
import { IPackage, PackageOptions, PackagingSObjects } from '../interfaces';
import {
  PackageInstallOptions,
  PackageInstallCreateRequest,
  PackageIdType,
} from '../interfaces/packagingInterfacesAndType';
import { listPackages } from './packageList';
import { getExternalSites, getStatus, installPackage, waitForPublish } from './packageInstall';

type PackageInstallRequest = PackagingSObjects.PackageInstallRequest;

const packagePrefixes = {
  PackageId: '0Ho',
  SubscriberPackageVersionId: '04t',
  PackageInstallRequestId: '0Hf',
  PackageUninstallRequestId: '06y',
};

Messages.importMessagesDirectory(__dirname);
const messages = Messages.loadMessages('@salesforce/packaging', 'package');

/**
 * Package class.
 *
 * This class provides the base implementation for a package.
 */
export class Package extends AsyncCreatable<PackageOptions> implements IPackage {
  public constructor(private options: PackageOptions) {
    super(options);
  }

  /**
   * Given a Salesforce ID for a package resource and the type of resource,
   * ensures the ID is valid.
   *
   * Valid ID types and prefixes for packaging resources:
   * 1. package ID (0Ho)
   * 2. subscriber package version ID (04t)
   * 3. package install request ID (0Hf)
   * 4. package uninstall request ID (06y)
   *
   * @param id Salesforce ID for a specific package resource
   * @param type The type of package ID
   */
  public static validateId(id: string, type: PackageIdType): void {
    const prefix = packagePrefixes[type];
    if (!id.startsWith(prefix)) {
      throw messages.createError('invalidPackageId', [type, id, prefix]);
    }
    if (!sfdc.validateSalesforceId(id)) {
      throw messages.createError('invalidIdLength', [type, id]);
    }
  }

  public convert(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public create(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public delete(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async install(
    pkgInstallCreateRequest: PackageInstallCreateRequest,
    options?: PackageInstallOptions
  ): Promise<PackageInstallRequest> {
    return installPackage(this.options.connection, pkgInstallCreateRequest, options);
  }

  public async getInstallStatus(installRequestId: string): Promise<PackageInstallRequest> {
    return getStatus(this.options.connection, installRequestId);
  }

  public list(): Promise<QueryResult<PackagingSObjects.Package2>> {
    return listPackages(this.options.connection);
  }

  public uninstall(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public update(): Promise<void> {
    return Promise.resolve(undefined);
  }

  public async getPackage(packageId: string): Promise<PackagingSObjects.Package2> {
    const package2 = await this.options.connection.tooling.sobject('Package2').retrieve(packageId);
    return package2 as unknown as PackagingSObjects.Package2;
  }

  public async getExternalSites(
    subscriberPackageVersionId: string,
    installationKey?: string
  ): Promise<Optional<string[]>> {
    return getExternalSites(this.options.connection, subscriberPackageVersionId, installationKey);
  }

  public async waitForPublish(
    subscriberPackageVersionId: string,
    timeout: number | Duration,
    installationKey?: string
  ): Promise<void> {
    return waitForPublish(this.options.connection, subscriberPackageVersionId, timeout, installationKey);
  }

  protected init(): Promise<void> {
    return Promise.resolve(undefined);
  }
}
