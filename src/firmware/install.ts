/** Progress of a firmware install, whichever device is taking it. */
export interface InstallProgress {
  /**
   * upload: bytes crossing the wire. verify, trailer: the Coldcard's own checks.
   * inspect: the CatCard checking the image it received. approve: waiting for the
   * person to approve on the device. reboot: the device is restarting to install.
   */
  stage: 'upload' | 'verify' | 'trailer' | 'inspect' | 'approve' | 'reboot';
  sent: number;
  total: number;
  /** What the CatCard said about the offered image, once it has checked it. */
  offer?: { verified: boolean; older: boolean; version: string };
}
