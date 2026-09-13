#ifndef PayloadDir
  #error PayloadDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef WindowsVersion
  #error WindowsVersion is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#ifndef Bootstrapper
  #error Bootstrapper is required
#endif
#ifdef UnsignedBuild
  #define ArtifactSuffix "-unsigned"
#else
  #define ArtifactSuffix ""
#endif

[Setup]
AppId={{3BAE290E-C3A4-4477-9A29-657507B60381}
AppName=Data Formulator
AppVersion={#AppVersion}
AppPublisher=Microsoft Corporation
AppPublisherURL=https://github.com/microsoft/data-formulator
VersionInfoVersion={#WindowsVersion}
DefaultDirName={localappdata}\Programs\Data Formulator
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
MinVersion=10.0.22000
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=Data-Formulator-{#AppVersion}-Windows-x64-Setup{#ArtifactSuffix}
SetupIconFile=..\icons\data-formulator.ico
UninstallDisplayIcon={app}\versions\{#WindowsVersion}\Data Formulator.exe
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
SetupLogging=yes
#ifdef UnsignedBuild
SignedUninstaller=no
#else
SignTool=dfrelease
SignedUninstaller=yes
#endif

[Tasks]
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}\versions\{#WindowsVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Bootstrapper}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\Data Formulator"; Filename: "{app}\versions\{#WindowsVersion}\Data Formulator.exe"; WorkingDir: "{app}\versions\{#WindowsVersion}"
Name: "{autodesktop}\Data Formulator"; Filename: "{app}\versions\{#WindowsVersion}\Data Formulator.exe"; WorkingDir: "{app}\versions\{#WindowsVersion}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Data Formulator\Installer"; ValueType: string; ValueName: "Version"; ValueData: "{#WindowsVersion}"; Flags: uninsdeletekey

[Run]
Filename: "{app}\versions\{#WindowsVersion}\Data Formulator.exe"; Description: "Launch Data Formulator"; Flags: nowait postinstall skipifsilent unchecked

[Code]
var
  PreviousVersion: String;

function VersionPart(var Value: String): Integer;
var
  Separator: Integer;
begin
  Separator := Pos('.', Value);
  if Separator = 0 then begin
    Result := StrToIntDef(Value, -1);
    Value := '';
  end else begin
    Result := StrToIntDef(Copy(Value, 1, Separator - 1), -1);
    Delete(Value, 1, Separator);
  end;
end;

function CompareVersions(Left, Right: String): Integer;
var
  Part, LeftPart, RightPart: Integer;
begin
  Result := 0;
  for Part := 1 to 4 do begin
    LeftPart := VersionPart(Left);
    RightPart := VersionPart(Right);
    if LeftPart > RightPart then begin Result := 1; Exit; end;
    if LeftPart < RightPart then begin Result := -1; Exit; end;
  end;
end;

function AppIsRunning(): Boolean;
var
  Locator, Services, Processes: Variant;
begin
  Result := True;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Services := Locator.ConnectServer('', 'root\CIMV2');
    Processes := Services.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''Data Formulator.exe''');
    Result := Processes.Count > 0;
  except
    Log('Could not check running applications: ' + GetExceptionMessage);
  end;
end;

function HasWebView2(): Boolean;
var
  RuntimeVersion: String;
  Key: String;
begin
  Key := 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  Result := (RegQueryStringValue(HKCU, Key, 'pv', RuntimeVersion) and
    (RuntimeVersion <> '') and (RuntimeVersion <> '0.0.0.0'));
  if not Result then
    Result := (RegQueryStringValue(HKLM32, Key, 'pv', RuntimeVersion) and
      (RuntimeVersion <> '') and (RuntimeVersion <> '0.0.0.0'));
end;

function InitializeSetup(): Boolean;
begin
  Result := False;
  RegQueryStringValue(HKCU, 'Software\Microsoft\Data Formulator\Installer', 'Version', PreviousVersion);
  if (PreviousVersion <> '') and (CompareVersions(PreviousVersion, '{#WindowsVersion}') > 0) then begin
    SuppressibleMsgBox('A newer Data Formulator version is installed. Downgrades are not supported.', mbError, MB_OK, IDOK);
    Exit;
  end;
  Result := True;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if AppIsRunning() then begin
    Result := 'Close Data Formulator and its running analyses before installing. No processes were stopped.';
    Exit;
  end;
  if not HasWebView2() then begin
    ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
    if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then begin
      Result := 'Could not start Microsoft WebView2 setup. See the installation log.';
      Exit;
    end;
    Log(Format('WebView2 setup exit code: %d', [ExitCode]));
    if (ExitCode <> 0) or not HasWebView2() then
      Result := 'Microsoft WebView2 installation did not complete. Check network access and your organization policy, then retry setup.';
  end;
end;

function InitializeUninstall(): Boolean;
begin
  Result := not AppIsRunning();
  if not Result then
    SuppressibleMsgBox('Close Data Formulator before uninstalling. Your workspaces and settings will be preserved.', mbError, MB_OK, IDOK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PreviousPath: String;
  Position: Integer;
begin
  if (CurStep <> ssDone) or (PreviousVersion = '') or (PreviousVersion = '{#WindowsVersion}') then Exit;
  for Position := 1 to Length(PreviousVersion) do
    if ((PreviousVersion[Position] < '0') or (PreviousVersion[Position] > '9')) and (PreviousVersion[Position] <> '.') then Exit;
  if (Pos('..', PreviousVersion) > 0) or (Length(PreviousVersion) > 23) then Exit;
  PreviousPath := ExpandConstant('{app}\versions\') + PreviousVersion;
  if FileExists(PreviousPath + '\.data-formulator-payload') then
    if not DelTree(PreviousPath, True, True, True) then
      Log('Previous application payload could not be fully removed: ' + PreviousPath);
end;