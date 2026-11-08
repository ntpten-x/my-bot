# Owner types the password in masked Windows fields; never pass it in argv or print it.
param([Parameter(Mandatory = $true)][string]$SecretPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form = New-Object Windows.Forms.Form
$form.Text = 'MY-BOT - Set local viewer password'
$form.Size = New-Object Drawing.Size(460, 260)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$label = New-Object Windows.Forms.Label
$label.Text = 'Set 8 characters (letters, numbers or symbols, no spaces). Do not reuse your Facebook password.'
$label.SetBounds(20, 15, 410, 45)
$form.Controls.Add($label)
$password = New-Object Windows.Forms.TextBox
$password.UseSystemPasswordChar = $true
$password.MaxLength = 8
$password.SetBounds(20, 70, 400, 25)
$form.Controls.Add($password)
$confirmLabel = New-Object Windows.Forms.Label
$confirmLabel.Text = 'Confirm password:'
$confirmLabel.SetBounds(20, 105, 400, 20)
$form.Controls.Add($confirmLabel)
$confirm = New-Object Windows.Forms.TextBox
$confirm.UseSystemPasswordChar = $true
$confirm.MaxLength = 8
$confirm.SetBounds(20, 130, 400, 25)
$form.Controls.Add($confirm)
$save = New-Object Windows.Forms.Button
$save.Text = 'Save'
$save.SetBounds(240, 175, 85, 28)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Cancel'
$cancel.SetBounds(335, 175, 85, 28)
$cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
$form.Controls.AddRange(@($save, $cancel))
$form.AcceptButton = $save
$form.CancelButton = $cancel
$save.Add_Click({
    if ($password.Text -notmatch '^[!-~]{8}$' -or $password.Text -cne $confirm.Text) {
        [Windows.Forms.MessageBox]::Show('Enter matching passwords with exactly 8 printable ASCII characters, without spaces.', 'MY-BOT') | Out-Null
        return
    }
    $form.DialogResult = [Windows.Forms.DialogResult]::OK
    $form.Close()
})
try {
    if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { throw 'Password setup cancelled. No password was saved.' }
    # The caller pre-creates this private file in its 0700 WSL runtime directory.
    # WriteAllText truncates that file without replacing its permission-protected inode.
    $target = Get-Item -LiteralPath $SecretPath
    if ($target.PSIsContainer -or $target.Name -ne 'input' -or $target.Directory.Name -notlike 'password-request-*') { throw 'Invalid private password handoff file.' }
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($target.FullName, $password.Text, $encoding)
    Write-Output 'PASS: password entered. Saving in WSL.'

} finally {
    $password.Clear()
    $confirm.Clear()
    $form.Dispose()
}
